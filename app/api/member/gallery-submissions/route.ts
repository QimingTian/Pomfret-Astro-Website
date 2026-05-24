import { NextRequest, NextResponse } from 'next/server'
import { createGallerySubmission } from '@/lib/gallery-submission-store'
import { requireUser } from '@/lib/member-auth'

export const runtime = 'nodejs'

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

  const b = body as Record<string, unknown>
  const description = typeof b.description === 'string' ? b.description : ''
  const fileName = typeof b.fileName === 'string' ? b.fileName : ''
  const contentType = typeof b.contentType === 'string' ? b.contentType : ''
  const fileSize = typeof b.fileSize === 'number' ? b.fileSize : Number(b.fileSize)

  const result = await createGallerySubmission({
    user: auth.user,
    description,
    fileName,
    contentType,
    fileSize,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true as const,
    submissionId: result.submission.id,
    uploadUrl: result.uploadUrl,
  })
}
