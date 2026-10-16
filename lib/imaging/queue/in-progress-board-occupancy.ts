import { estimateSessionDurationMs } from '@/lib/imaging-schedule-bar'
import type { SessionBoardEntry } from '@/lib/imaging-session-board'

export type BoardOccupancy = { id: string; target: string; startMs: number; endMs: number }

/** Single-night work leaves the queue when NINA downloads it, but still occupies the telescope. */
export function collectInProgressBoardOccupancy(
  board: SessionBoardEntry[],
  nightKey: string,
  windowStartMs: number,
  deadlineMs: number,
  nowMs: number
): BoardOccupancy[] {
  const occupied: BoardOccupancy[] = []
  for (const row of board) {
    if (row.status !== 'in_progress' || row.projectMode === true) continue
    const plannedMs = Date.parse(row.plannedStartIso ?? '')
    const downloadedMs = Date.parse(row.downloadedAt ?? '')
    const barMs = row.scheduleStripNightKey === nightKey ? row.scheduleBarStartMs : null
    const createdMs = Date.parse(row.createdAt)
    const starts = [plannedMs, downloadedMs, barMs, createdMs]
      .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms))
    if (starts.length === 0) continue
    const startMs = Math.max(...starts)
    const estimatedEndMs = startMs + estimateSessionDurationMs({ ...row, raHours: row.raHours ?? undefined })
    const barEndMs = row.scheduleStripNightKey === nightKey ? row.scheduleBarEndMs : null
    const plannedEndMs = Math.max(estimatedEndMs, barEndMs ?? -Infinity)
    // A session still marked in progress after its estimate may overrun; reserve the rest of tonight.
    const endMs = plannedEndMs > nowMs ? plannedEndMs : deadlineMs
    const clippedStartMs = Math.max(startMs, windowStartMs)
    const clippedEndMs = Math.min(endMs, deadlineMs)
    if (clippedEndMs > clippedStartMs) {
      occupied.push({ id: row.id, target: row.target, startMs: clippedStartMs, endMs: clippedEndMs })
    }
  }
  return occupied.sort((a, b) => a.startMs - b.startMs)
}
