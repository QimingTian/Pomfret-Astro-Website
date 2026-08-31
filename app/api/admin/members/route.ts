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
  deleteMemberById,
  isBootstrapAdminEmail,
  listMembersForAdminDirectory,
  setMemberAsAdmin,
  setMemberAsMember,
  setMemberImagingApproval,
} from '@/lib/member-store'
import { resolveObservatorySite } from '@/lib/observatory-sites'

export const runtime = 'nodejs'

/** GET — list signed-up members. PA Admin: all sites; site admin: affiliated members only. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }

    const scope = adminMembersDirectoryScope(auth.user)
    const membersRaw = await listMembersForAdminDirectory()
    const members =
      scope === 'all'
        ? membersRaw
        : filterMembersForAdminSite(membersRaw, site.id)

    return NextResponse.json({
      ok: true as const,
      total: members.length,
      members,
      scope: scope === 'all' ? 'all' : site.id,
      siteName: scope === 'all' ? null : resolveObservatorySite(site.id).name,
      canManageAdmins: isBootstrapAdminEmail(auth.user.email),
      currentUserId: auth.user.id,
    })
  })
}

/** PATCH — promote admin or approve/reject imaging. Admin only. */
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
    if (scope !== 'all') {
      const members = await listMembersForAdminDirectory()
      const target = members.find((m) => m.id === id)
      if (!target || !target.memberships.some((m) => m.siteId === site.id)) {
        return NextResponse.json({ ok: false, error: 'Member not found at this observatory.' }, { status: 404 })
      }
    }

    const imagingAction = rec.imagingAction
    if (imagingAction === 'approve' || imagingAction === 'reject') {
      const result = await setMemberImagingApproval(id, imagingAction)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
      const membersRaw = await listMembersForAdminDirectory()
      const members =
        scope === 'all' ? membersRaw : filterMembersForAdminSite(membersRaw, site.id)
      return NextResponse.json({
        ok: true as const,
        total: members.length,
        members,
        scope: scope === 'all' ? 'all' : site.id,
        siteName: scope === 'all' ? null : resolveObservatorySite(site.id).name,
        canManageAdmins: isBootstrapAdminEmail(auth.user.email),
        currentUserId: auth.user.id,
      })
    }

    if (!isPomfretAstroAdmin(auth.user.systemRole)) {
      return NextResponse.json({ ok: false, error: 'Only Pomfret Astro Admin may change roles.' }, { status: 403 })
    }

    const roleAction = rec.roleAction
    if (roleAction === 'member') {
      const result = await setMemberAsMember(auth.user.id, id)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
      }
      const members = await listMembersForAdminDirectory()
      return NextResponse.json({
        ok: true as const,
        total: members.length,
        members,
        scope: 'all' as const,
        siteName: null,
        canManageAdmins: isBootstrapAdminEmail(auth.user.email),
        currentUserId: auth.user.id,
      })
    }

    const result = await setMemberAsAdmin(id)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }
    const members = await listMembersForAdminDirectory()
    return NextResponse.json({
      ok: true as const,
      total: members.length,
      members,
      scope: 'all' as const,
      siteName: null,
      canManageAdmins: isBootstrapAdminEmail(auth.user.email),
      currentUserId: auth.user.id,
    })
  })
}

/** DELETE — remove a member account (not admins). Admin only. */
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

    const scope = adminMembersDirectoryScope(auth.user)
    if (scope !== 'all') {
      const members = await listMembersForAdminDirectory()
      const target = members.find((m) => m.id === id)
      if (!target || !target.memberships.some((m) => m.siteId === site.id)) {
        return NextResponse.json({ ok: false, error: 'Member not found at this observatory.' }, { status: 404 })
      }
    }

    const result = await deleteMemberById(auth.user.id, id)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }
    const membersRaw = await listMembersForAdminDirectory()
    const members =
      scope === 'all' ? membersRaw : filterMembersForAdminSite(membersRaw, site.id)
    return NextResponse.json({
      ok: true as const,
      total: members.length,
      members,
      scope: scope === 'all' ? 'all' : site.id,
      siteName: scope === 'all' ? null : resolveObservatorySite(site.id).name,
      canManageAdmins: isBootstrapAdminEmail(auth.user.email),
      currentUserId: auth.user.id,
    })
  })
}
