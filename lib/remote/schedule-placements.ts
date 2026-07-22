import { estimateDurationSecondsFromPlans } from '@/lib/remote/duration'

export type TerminalSessionLike = {
  id: string
  status: string
  createdAt: string
  nightKey?: string
  plannedStartIso?: string | null
  failedAt?: string | null
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
  estimatedDurationSeconds?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
}

export function serverScheduleBarForNight(
  item: TerminalSessionLike,
  nightKey: string
): { startMs: number; endMs: number } | null {
  if (item.scheduleStripNightKey !== nightKey) return null
  const startMs = item.scheduleBarStartMs
  const endMs = item.scheduleBarEndMs
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null
  }
  if (endMs <= startMs) return null
  return { startMs, endMs }
}

export function sessionDurationMsFromItem(item: {
  estimatedDurationSeconds?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
}): number {
  const estimatedSeconds =
    typeof item.estimatedDurationSeconds === 'number' && Number.isFinite(item.estimatedDurationSeconds)
      ? item.estimatedDurationSeconds
      : estimateDurationSecondsFromPlans(item.filterPlans)
  return Math.max(estimatedSeconds, 60) * 1000
}

export type ScheduledStripItem = TerminalSessionLike & { target: string }

export function listScheduledPendingPlacements(
  scheduleStripItems: ScheduledStripItem[],
  imagingStartMs: number,
  schedulingDeadlineMs: number,
  tonightNightKey: string
): Array<{ item: ScheduledStripItem; startMs: number; endMs: number }> {
  return scheduleStripItems
    .filter((item) => item.status === 'scheduled')
    .map((item) => {
      const serverBar = serverScheduleBarForNight(item, tonightNightKey)
      if (serverBar) {
        const startMs = Math.max(serverBar.startMs, imagingStartMs)
        const endMs = Math.min(serverBar.endMs, schedulingDeadlineMs)
        if (endMs <= startMs) return null
        return { item, startMs, endMs }
      }
      const startMsRaw = item.plannedStartIso ? Date.parse(item.plannedStartIso) : Number.NaN
      if (!Number.isFinite(startMsRaw)) return null
      if (startMsRaw < imagingStartMs - 60_000) return null
      const durationMs = sessionDurationMsFromItem(item)
      const startMs = Math.max(startMsRaw, imagingStartMs)
      const endMs = Math.min(startMs + durationMs, schedulingDeadlineMs)
      if (endMs <= startMs) return null
      return { item, startMs, endMs }
    })
    .filter((x): x is { item: ScheduledStripItem; startMs: number; endMs: number } => x != null)
    .sort((a, b) => a.startMs - b.startMs)
}

export function placementToTimelineBlock(
  scheduled: { item: { id: string; target: string }; startMs: number; endMs: number },
  windowStartMs: number,
  windowEndMs: number
): { id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string } {
  const topPct = ((scheduled.startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
  const heightPct = ((scheduled.endMs - scheduled.startMs) / (windowEndMs - windowStartMs)) * 100
  return {
    id: scheduled.item.id,
    startMs: scheduled.startMs,
    endMs: scheduled.endMs,
    topPct,
    heightPct,
    label: scheduled.item.target,
  }
}

/** Earliest time a session block may appear on the strip (after 4pm anchor, not before nautical dusk). */
export function imagingWindowStartMs(windowStartMs: number, nauticalDuskMs: number): number {
  return Math.max(windowStartMs, nauticalDuskMs)
}

export function fallbackPlacementForTerminalSession(
  item: TerminalSessionLike,
  locked: Record<string, { startMs: number; endMs: number }>,
  windowStartMs: number,
  schedulingDeadlineMs: number,
  nowMs: number,
): { startMs: number; endMs: number } | null {
  const existing = locked[item.id]
  if (
    existing &&
    Number.isFinite(existing.startMs) &&
    Number.isFinite(existing.endMs) &&
    existing.endMs > existing.startMs
  ) {
    return { startMs: existing.startMs, endMs: existing.endMs }
  }

  const durationMs = sessionDurationMsFromItem(item)
  let startMs: number | null = null
  if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t)) startMs = t
  }
  if (startMs == null) {
    const c = Date.parse(item.createdAt)
    if (Number.isFinite(c)) startMs = c
  }
  if (startMs == null && item.status === 'in_progress') {
    startMs = nowMs
  }
  if (startMs == null) return null

  let s = Math.max(startMs, windowStartMs)
  let e = Math.min(s + durationMs, schedulingDeadlineMs)
  if (item.status === 'failed' && item.failedAt) {
    const failMs = Date.parse(item.failedAt)
    if (Number.isFinite(failMs)) {
      e = Math.min(e, failMs, schedulingDeadlineMs)
    }
  }
  if (e <= s) {
    s = Math.max(windowStartMs, schedulingDeadlineMs - 5 * 60 * 1000)
    e = schedulingDeadlineMs
  }
  if (e <= s) return null
  return { startMs: s, endMs: e }
}

/**
 * in_progress sessions must stay on one full-duration bar for tonight — never re-pack to weather windows.
 * Start: frozen lock → planned → created → now. End: start + estimated duration (cap at dawn only).
 */
export function inProgressSchedulePlacement(
  item: TerminalSessionLike,
  locked: Record<string, { startMs: number; endMs: number }>,
  imagingStartMs: number,
  schedulingDeadlineMs: number,
  nowMs: number
): { startMs: number; endMs: number } | null {
  const durationMs = sessionDurationMsFromItem(item)
  const existing = locked[item.id]

  let startMs: number | null = null
  if (existing && Number.isFinite(existing.startMs)) {
    startMs = existing.startMs
  } else if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t)) startMs = t
  }
  if (startMs == null) {
    const c = Date.parse(item.createdAt)
    if (Number.isFinite(c)) startMs = c
  }
  if (startMs == null) startMs = nowMs

  const start = Math.max(startMs, imagingStartMs)
  const end = Math.min(start + durationMs, schedulingDeadlineMs)
  if (end <= start) return null
  return { startMs: start, endMs: end }
}

/** Completed rows only belong on the current 4pm→8am strip if their time range overlaps that window. */
export function completedSessionOverlapsTonightStripWindow(
  item: TerminalSessionLike,
  tonightNightKey: string,
  windowStartMs: number,
  windowEndMs: number,
  locked: Record<string, { startMs: number; endMs: number }>,
): boolean {
  if (item.nightKey && item.nightKey !== tonightNightKey) return false
  const durationMs = sessionDurationMsFromItem(item)
  const lock = locked[item.id]
  if (
    lock &&
    Number.isFinite(lock.startMs) &&
    Number.isFinite(lock.endMs) &&
    lock.endMs > lock.startMs
  ) {
    if (lock.endMs > windowStartMs && lock.startMs < windowEndMs) return true
  }
  if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t) && t + durationMs > windowStartMs && t < windowEndMs) return true
  }
  const c = Date.parse(item.createdAt)
  return Number.isFinite(c) && c + durationMs > windowStartMs && c < windowEndMs
}
