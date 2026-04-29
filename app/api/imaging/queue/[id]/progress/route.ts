import { listSessionProgressLinesFromAudit } from '@/lib/imaging-audit-log'
import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import { validateSessionPassword } from '@/lib/imaging-session-access'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById } from '@/lib/imaging-queue-store'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Live lines for Remote "terminal" (no auth for now). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  }

  const providedPassword =
    request.headers.get('x-session-password') ?? request.headers.get('x-admin-password') ?? ''
  const isAdmin = isImagingAdminPassword(providedPassword)
  if (!isAdmin) {
    const auth = await validateSessionPassword(id, providedPassword)
    if (!auth.ok) {
      return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
    }
  }

  const req = await getRequestById(id)
  const board = await getBoardEntry(id)
  if (!req && !board) {
    return withImagingCors({ ok: false as const, error: 'Not found' }, 404)
  }

  const lines = await listSessionProgressLinesFromAudit(id)
  const queueStatus = req?.status ?? board?.status ?? 'pending'

  return withImagingCors({
    ok: true as const,
    queueStatus,
    lines,
  })
}
