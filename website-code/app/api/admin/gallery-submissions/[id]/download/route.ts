import { NextRequest, NextResponse } from 'next/server'
import { downloadGallerySubmission } from '@/lib/gallery-submission-store'
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

  const result = await downloadGallerySubmission(id, auth.user.id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  const safeName = result.fileName.replace(/[^\w.\-()+ ]+/g, '_') || 'gallery-submission.png'
  return new NextResponse(new Uint8Array(result.body), {
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
