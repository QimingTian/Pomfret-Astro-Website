import { NextRequest, NextResponse } from 'next/server'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import {
  adminMembersDirectoryScope,
  filterMembersForAdminSite,
} from '@/lib/admin-site-access'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { requireImagingAdmin } from '@/lib/imaging/core/admin-auth'
import { isPomfretAstroAdmin } from '@/lib/member-roles'
import {
  adminApplyMemberRole,
  adminSetMemberEmailVerified,
  deleteMemberById,
  isBootstrapAdminEmail,
  listMembersForAdminDirectory,
  removeMemberSiteAffiliation,
} from '@/lib/member-store'
import { resolveObservatorySite } from '@/lib/observatory-sites'

export const runtime = 'nodejs'

function membersResponse(
  auth: { user: { id: string; email: string; systemRole: string } },
  site: { id: string },
  scope: 'all' | string
) {
  const membersRaw = listMembersForAdminDirectory()
  return membersRaw.then((membersRawList) => {
    const members =
      scope === 'all' ? membersRawList : filterMembersForAdminSite(membersRawList, site.id)
    return {
      ok: true as const,
      total: members.length,
      members,
      scope: scope === 'all' ? 'all' : site.id,
      siteName: scope === 'all' ? null : resolveObservatorySite(site.id).name,
      canManageAdmins: isBootstrapAdminEmail(auth.user.email),
      currentUserId: auth.user.id,
      isPaAdmin: isPomfretAstroAdmin(auth.user.systemRole),
    }
  })
}

/** GET — list signed-up members. PA Admin: all sites; site admin: affiliated members only. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }

    const scope = adminMembersDirectoryScope(auth.user)
    const payload = await membersResponse(auth, site, scope)
    return NextResponse.json(payload)
  })
}

/** PATCH — update member role or email verification. */
export async function PATCH(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
    if (!isSameSiteMutation(request)) {
      return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
    }

    const scope = adminMembersDirectoryScope(auth.user)
    const isPaAdmin = isPomfretAstroAdmin(auth.user.systemRole)
    const members = await listMembersForAdminDirectory()
    const target = members.find((m) => m.id === id)
    if (!target) {
      return NextResponse.json({ ok: false, error: 'Member not found.' }, { status: 404 })
    }
    if (scope !== 'all' && !target.memberships.some((m) => m.siteId === site.id)) {
      return NextResponse.json({ ok: false, error: 'Member not found at this observatory.' }, { status: 404 })
    }
    if (id === auth.user.id) {
      return NextResponse.json({ ok: false, error: 'You cannot edit your own account here.' }, { status: 400 })
    }
    if (target.bootstrapAdmin && !isBootstrapAdminEmail(auth.user.email)) {
      return NextResponse.json({ ok: false, error: 'This administrator account cannot be edited here.' }, { status: 403 })
    }
    if (!isPaAdmin && isPomfretAstroAdmin(target.systemRole)) {
      return NextResponse.json({ ok: false, error: 'You cannot edit Pomfret Astro Admin accounts.' }, { status: 403 })
    }

    if (typeof rec.emailVerified === 'boolean') {
      const result = await adminSetMemberEmailVerified(id, rec.emailVerified)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
    }

    if (typeof rec.roleKey === 'string' && rec.roleKey.trim()) {
      const result = await adminApplyMemberRole({
        targetUserId: id,
        roleKey: rec.roleKey.trim(),
        actorIsPaAdmin: isPaAdmin,
        actorSiteId: site.id,
      })
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
    }

    const payload = await membersResponse(auth, site, scope)
    return NextResponse.json(payload)
  })
}

/**
 * DELETE —
 * PA Admin: permanently delete the account.
 * Observatory Admin: remove affiliation at this site only (last site → Guest).
 */
export async function DELETE(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
    if (!isSameSiteMutation(request)) {
      return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
    }

    const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
    }
    if (id === auth.user.id) {
      return NextResponse.json({ ok: false, error: 'You cannot remove your own account.' }, { status: 400 })
    }

    const scope = adminMembersDirectoryScope(auth.user)
    const isPaAdmin = isPomfretAstroAdmin(auth.user.systemRole)
    const members = await listMembersForAdminDirectory()
    const target = members.find((m) => m.id === id)
    if (!target) {
      return NextResponse.json({ ok: false, error: 'Member not found.' }, { status: 404 })
    }
    if (!isPaAdmin && !target.memberships.some((m) => m.siteId === site.id)) {
      return NextResponse.json({ ok: false, error: 'Member not found at this observatory.' }, { status: 404 })
    }
    if (!isPaAdmin && isPomfretAstroAdmin(target.systemRole)) {
      return NextResponse.json({ ok: false, error: 'You cannot remove Pomfret Astro Admin.' }, { status: 403 })
    }

    if (isPaAdmin) {
      const result = await deleteMemberById(auth.user.id, id)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
    } else {
      const result = await removeMemberSiteAffiliation(auth.user.id, id, site.id)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
    }

    const payload = await membersResponse(auth, site, scope)
    return NextResponse.json(payload)
  })
}
