import type { SessionBoardEntry } from '@/lib/imaging-session-board'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'

export type ScheduleBarPlacement = {
  nightKey: string
  startMs: number
  endMs: number
}

export function estimateSessionDurationMs(entry: {
  estimatedDurationSeconds?: number
  exposureSeconds?: number
  count?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
}): number {
  if (typeof entry.estimatedDurationSeconds === 'number' && Number.isFinite(entry.estimatedDurationSeconds)) {
    return Math.max(entry.estimatedDurationSeconds, 60) * 1000
  }
  if (Array.isArray(entry.filterPlans) && entry.filterPlans.length > 0) {
    const imagingSeconds = entry.filterPlans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0)
    return Math.max(imagingSeconds + 15 * 60, 15 * 60) * 1000
  }
  const exp = typeof entry.exposureSeconds === 'number' ? entry.exposureSeconds : 0
  const count = typeof entry.count === 'number' ? entry.count : 0
  if (exp > 0 && count > 0) return Math.max(exp * count + 15 * 60, 15 * 60) * 1000
  return 15 * 60 * 1000
}

/** Server-side fallback when no bar was saved before terminal transition. */
export function fallbackScheduleBarPlacement(
  entry: Pick<SessionBoardEntry, 'createdAt' | 'estimatedDurationSeconds' | 'exposureSeconds' | 'count' | 'filterPlans'>,
  terminalEndMs: number,
  now = new Date()
): ScheduleBarPlacement {
  const strip = getTonightScheduleStrip(now)
  const durationMs = estimateSessionDurationMs(entry)
  const createdMs = Date.parse(entry.createdAt)
  let startMs = Number.isFinite(createdMs) ? createdMs : strip.windowStartMs
  startMs = Math.max(startMs, strip.windowStartMs, strip.nauticalDuskMs)
  let endMs = Math.min(Math.max(terminalEndMs, startMs + 60_000), startMs + durationMs, strip.schedulingDeadlineMs)
  if (endMs <= startMs) {
    endMs = Math.min(Math.max(terminalEndMs, startMs + 60_000), strip.schedulingDeadlineMs)
  }
  return { nightKey: strip.nightKey, startMs, endMs }
}

export function readScheduleBarFromEntry(
  entry: SessionBoardEntry,
  nightKey: string
): ScheduleBarPlacement | null {
  if (entry.scheduleStripNightKey !== nightKey) return null
  const startMs = entry.scheduleBarStartMs
  const endMs = entry.scheduleBarEndMs
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null
  }
  if (endMs <= startMs) return null
  return { nightKey, startMs, endMs }
}

export function hasFrozenScheduleBar(entry: SessionBoardEntry, nightKey: string): boolean {
  return readScheduleBarFromEntry(entry, nightKey) != null
}
