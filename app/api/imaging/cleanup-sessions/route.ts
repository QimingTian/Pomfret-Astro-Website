import { NextRequest } from 'next/server'

import { appendAuditLog } from '@/lib/imaging-audit-log'
import { boardPurgeCompletedOlderThan } from '@/lib/imaging-session-board'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

const RETENTION_MS = 48 * 60 * 60 * 1000

export function OPTIONS() {
  return imagingCorsOptions()
}

function cronAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return true
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${expected}`
}

/** Vercel Cron: purge completed sessions older than 48 hours. */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }
  const purgedQueueIds = await boardPurgeCompletedOlderThan(RETENTION_MS)
  for (const queueId of purgedQueueIds) {
    await deleteR2ObjectForQueueId(queueId)
    await removePreviewImage(queueId)
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Session ${queueId} deleted by daily cron retention cleanup.`,
      detail: { id: queueId, source: 'cron_retention_48h' },
    })
  }
  return withImagingCors({ ok: true as const, purged: purgedQueueIds.length, ids: purgedQueueIds })
}
