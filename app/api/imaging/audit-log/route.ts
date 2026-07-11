import { NextRequest } from 'next/server'
import { requireImagingAdmin } from '@/lib/imaging-admin-auth'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { listAuditLog } from '@/lib/imaging-audit-log'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const admin = await requireImagingAdmin(request)
  if (!admin.ok) {
    return withImagingCors({ ok: false as const, error: admin.error }, admin.status)
  }

  const raw = request.nextUrl.searchParams.get('limit')
  const limit = raw != null ? Number(raw) : 250
  const safe = Number.isFinite(limit) ? Math.min(400, Math.max(1, Math.floor(limit))) : 250

  const entries = await listAuditLog(safe)
  return withImagingCors({ ok: true as const, entries })
}
