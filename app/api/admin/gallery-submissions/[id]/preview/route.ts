import { NextRequest, NextResponse } from 'next/server'
import { getGallerySubmissionPreviewBuffer } from '@/lib/gallery-submission-store'
import { requireAdmin } from '@/lib/member-auth'

export const runtime = 'nodejs'

export async function GET(
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

  const preview = await getGallerySubmissionPreviewBuffer(id)
  if (!preview) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(preview.body), {
    headers: {
      'Content-Type': preview.contentType,
      'Cache-Control': 'no-store',
    },
  })
}
