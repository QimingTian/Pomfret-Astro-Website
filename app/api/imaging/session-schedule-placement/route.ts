import { NextRequest } from 'next/server'
import { isProjectNightSubId } from '@/lib/imaging-project-ids'
import { setNightScheduleBar } from '@/lib/imaging-project-store'
import { boardSetScheduleBar, getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById } from '@/lib/imaging-queue-store'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Persist Tonight's Schedule bar position for a board session (KV-backed).
 * Terminal rows (completed/failed) ignore updates once frozen for the current strip night.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }

  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const queueId = typeof rec.queueId === 'string' ? rec.queueId.trim() : ''
  const nightKey = typeof rec.nightKey === 'string' ? rec.nightKey.trim() : ''
  const startMs = Number(rec.startMs)
  const endMs = Number(rec.endMs)

  if (!queueId) {
    return withImagingCors({ ok: false as const, error: 'queueId is required' }, 400)
  }
  if (!nightKey) {
    return withImagingCors({ ok: false as const, error: 'nightKey is required' }, 400)
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return withImagingCors({ ok: false as const, error: 'Invalid startMs/endMs' }, 400)
  }

  const strip = getTonightScheduleStrip()
  if (nightKey !== strip.nightKey) {
    return withImagingCors({ ok: false as const, error: 'nightKey does not match current tonight strip' }, 400)
  }

  if (isProjectNightSubId(queueId)) {
    await setNightScheduleBar(queueId, { nightKey, startMs, endMs })
    return withImagingCors({ ok: true as const })
  }

  const board = await getBoardEntry(queueId)
  const queue = await getRequestById(queueId)
  if (!board && !queue) {
    return withImagingCors({ ok: false as const, error: 'Session not found' }, 404)
  }
  if (!board) {
    return withImagingCors(
      { ok: false as const, error: 'Schedule bar is only stored for sessions on the imaging board' },
      409
    )
  }

  const result = await boardSetScheduleBar(queueId, { nightKey, startMs, endMs })
  if (!result.ok) {
    return withImagingCors({ ok: false as const, error: result.error ?? 'Could not save placement' }, 409)
  }

  return withImagingCors({ ok: true as const })
}
