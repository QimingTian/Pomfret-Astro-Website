import { NextRequest, NextResponse } from 'next/server'
import { dismissGallerySubmission } from '@/lib/gallery-submission-store'
import { requireAdmin } from '@/lib/member-auth'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const params = await Promise.resolve(context.params)
  const id = params.id?.trim() ?? ''
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })
  }

  const result = await dismissGallerySubmission(id, auth.user.id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true as const })
}
