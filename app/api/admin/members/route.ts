import { NextRequest, NextResponse } from 'next/server'
import { checkAuthRateLimitAsync } from '@/lib/auth-rate-limit'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import { requireAdmin } from '@/lib/member-auth'
import {
  deleteMemberById,
  listMembersForAdminDirectory,
  setMemberAsAdmin,
  setMemberImagingApproval,
} from '@/lib/member-store'

export const runtime = 'nodejs'

/** GET — list signed-up members. Admin only. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  const members = await listMembersForAdminDirectory()
  return NextResponse.json({
    ok: true as const,
    total: members.length,
    members,
  })
}

/** PATCH — promote admin or approve/reject imaging. Admin only. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
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

  const imagingAction = rec.imagingAction
  if (imagingAction === 'approve' || imagingAction === 'reject') {
    const result = await setMemberImagingApproval(id, imagingAction)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }
    const members = await listMembersForAdminDirectory()
    return NextResponse.json({ ok: true as const, total: members.length, members })
  }

  const result = await setMemberAsAdmin(id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }
  const members = await listMembersForAdminDirectory()
  return NextResponse.json({ ok: true as const, total: members.length, members })
}

/** DELETE — remove a member account (not admins). Admin only. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
  }

  const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  }
  const result = await deleteMemberById(auth.user.id, id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }
  const members = await listMembersForAdminDirectory()
  return NextResponse.json({ ok: true as const, total: members.length, members })
}
