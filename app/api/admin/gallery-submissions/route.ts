import { NextRequest, NextResponse } from 'next/server'
import { listPendingGallerySubmissions } from '@/lib/gallery-submission-store'
import { requireAdmin } from '@/lib/member-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const submissions = await listPendingGallerySubmissions()
  const rows = submissions.map((s) => ({
    id: s.id,
    userId: s.userId,
    submitterLabel: s.submitterLabel,
    description: s.description,
    fileName: s.fileName,
    createdAt: s.createdAt,
    previewSrc: `/api/admin/gallery-submissions/${encodeURIComponent(s.id)}/preview`,
  }))

  return NextResponse.json({ ok: true as const, submissions: rows })
}
