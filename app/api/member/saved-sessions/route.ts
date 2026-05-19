import { NextRequest, NextResponse } from 'next/server'
import {
  deleteMemberSavedSession,
  getMemberSavedSessionById,
  listMemberSavedSessions,
  upsertMemberSavedSession,
} from '@/lib/member-saved-sessions'
import { requireUser } from '@/lib/member-auth'
import type { RemoteSavedSessionFormV1 } from '@/lib/remote-saved-session'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (id) {
    const session = await getMemberSavedSessionById(auth.user.id, id)
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({
      ok: true as const,
      session: {
        id: session.id,
        name: session.name,
        savedAt: session.savedAt,
        updatedAt: session.updatedAt,
        form: session.form,
      },
    })
  }

  const sessions = await listMemberSavedSessions(auth.user.id)
  return NextResponse.json({ ok: true as const, sessions })
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Expected JSON object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name : ''
  const form = b.form as RemoteSavedSessionFormV1 | undefined
  if (!form || typeof form !== 'object') {
    return NextResponse.json({ ok: false, error: 'form is required' }, { status: 400 })
  }

  try {
    const session = await upsertMemberSavedSession(auth.user.id, { name, form })
    return NextResponse.json({ ok: true as const, session })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not save session'
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  }
  const removed = await deleteMemberSavedSession(auth.user.id, id)
  if (!removed) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true as const })
}
