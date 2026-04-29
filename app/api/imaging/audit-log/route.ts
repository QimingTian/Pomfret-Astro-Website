import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { listAuditLog } from '@/lib/imaging-audit-log'

export const runtime = 'nodejs'

const ADMIN_PASSWORD = '1894'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password')
  if (password !== ADMIN_PASSWORD) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  const raw = request.nextUrl.searchParams.get('limit')
  const limit = raw != null ? Number(raw) : 250
  const safe = Number.isFinite(limit) ? Math.min(400, Math.max(1, Math.floor(limit))) : 250

  const entries = await listAuditLog(safe)
  return withImagingCors({ ok: true as const, entries })
}
