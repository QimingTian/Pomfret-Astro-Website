import { listSessionProgressLinesFromAudit } from '@/lib/imaging-audit-log'
import { authorizeImagingSession, resolveImagingSessionContext } from '@/lib/imaging-session-access'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Live lines for Remote "terminal" (no auth for now). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  }

  const providedPassword = request.headers.get('x-session-password')?.trim() || null
  const auth = await authorizeImagingSession(request, id, providedPassword)
  if (!auth.ok) {
    return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
  }

  const session = await resolveImagingSessionContext(id)
  if (!session) {
    return withImagingCors({ ok: false as const, error: 'Not found' }, 404)
  }

  const lines = await listSessionProgressLinesFromAudit(id)
  const queueStatus = session.queueStatus

  return withImagingCors({
    ok: true as const,
    queueStatus,
    lines,
  })
}
