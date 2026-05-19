import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/member-auth'
import {
  deleteMemberById,
  listMembersForAdminDirectory,
  setMemberAsAdmin,
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

/** PATCH — promote a member to admin. Admin only. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const id =
    body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
      ? (body as { id: string }).id.trim()
      : ''
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
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
