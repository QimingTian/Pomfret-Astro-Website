import {
  getBlockingInProgressProject,
  projectHasOpenSessionsForNightKey,
  remainingFramesTotal,
  tonightDurationSecondsFromPlans,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { moonFilterOkAt } from '@/lib/moon-avoidance'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { intervalsWhereAltitudeAtOrAbove } from '@/lib/target-altitude'

const MOON_SAMPLE_STEP_MS = 5 * 60 * 1000

/**
 * Time kept free before a project reservation starts. Scheduling subtracts it from queue free time
 * and delivery re-checks it, so a session that runs longer than its estimate cannot delay the
 * project's planned start.
 */
export const PROJECT_HOLD_START_MARGIN_MS = 10 * 60 * 1000

type AltitudeHoldProject = Pick<ImagingProject, 'raHours' | 'decDeg' | 'remainingByFilter'> &
  Partial<
    Pick<
      ImagingProject,
      'nights' | 'mosaicMode' | 'mosaicPanels' | 'mosaicRemainingByPanel'
    >
  >

/** In-progress multi-night project whose target-altitude window others must not use. */
export async function getActiveProjectForAltitudeHold(now = new Date()): Promise<ImagingProject | undefined> {
  const stripNightKey = getTonightScheduleStrip(now).nightKey
  const active = await getBlockingInProgressProject(undefined, stripNightKey)
  if (!active || remainingFramesTotal(active) <= 0) return undefined
  if (!projectHasOpenSessionsForNightKey(active, stripNightKey)) return undefined
  return active
}

/**
 * True when every remaining filter is moon-blocked at every sample from now to nautical dawn.
 * In that case the project cannot shoot leftover frames tonight, so altitude hold is released.
 */
export function remainingFiltersMoonBlockedTonight(
  project: AltitudeHoldProject,
  now = new Date()
): boolean {
  const remaining = (project.remainingByFilter ?? []).filter((row) => row.countRemaining > 0)
  if (remaining.length === 0) return false
  const window = getTonightSchedulingWindow(now)
  const startMs = Math.max(now.getTime(), window.nauticalDuskUtc.getTime())
  const endMs = window.nauticalDawnUtc.getTime()
  if (endMs <= startMs) return true
  for (const row of remaining) {
    for (let t = startMs; t < endMs; t += MOON_SAMPLE_STEP_MS) {
      if (moonFilterOkAt(row.filterName, project.raHours, project.decDeg, new Date(t))) {
        return false
      }
    }
  }
  return true
}

/** Frames the project still owes. `Infinity` when a mosaic cannot be counted (never trim the hold). */
function remainingFramesForHold(project: AltitudeHoldProject): number {
  if (project.mosaicMode && project.mosaicPanels?.length) {
    const perPanel = project.mosaicRemainingByPanel
    if (!perPanel || perPanel.length !== project.mosaicPanels.length) return Number.POSITIVE_INFINITY
    return perPanel.reduce(
      (sum, rows) => sum + rows.reduce((s, r) => s + Math.max(0, r.countRemaining), 0),
      0
    )
  }
  return (project.remainingByFilter ?? []).reduce((s, r) => s + Math.max(0, r.countRemaining), 0)
}

/**
 * End of tonight's last sub-session when tonight finishes the whole project, else `null`.
 *
 * Tonight's scheduled/in-progress subs finish the project when they cover every remaining frame, so
 * the target's ≥30° window past that sub can never be used by the project — reserving it would keep
 * the rest of the night closed to single-night sessions for nothing.
 */
function finalTonightSubSessionEndMs(
  project: AltitudeHoldProject,
  nightKey: string
): number | null {
  const tonight = (project.nights ?? []).filter(
    (night) =>
      night.nightKey === nightKey &&
      (night.status === 'scheduled' || night.status === 'in_progress')
  )
  if (tonight.length === 0) return null

  const framesTonight = tonight.reduce(
    (sum, night) =>
      sum + night.filterPlansTonight.reduce((s, plan) => s + Math.max(0, plan.count), 0),
    0
  )
  if (framesTonight <= 0) return null
  if (framesTonight < remainingFramesForHold(project)) return null

  let latestEndMs: number | null = null
  for (const night of tonight) {
    if (!night.plannedStartIso) return null
    const startMs = Date.parse(night.plannedStartIso)
    if (!Number.isFinite(startMs)) return null
    const durationSeconds = tonightDurationSecondsFromPlans(night.filterPlansTonight, {
      startMs,
      raHours: project.raHours,
    })
    if (durationSeconds <= 0) return null
    const endMs = startMs + durationSeconds * 1000
    latestEndMs = latestEndMs == null ? endMs : Math.max(latestEndMs, endMs)
  }
  return latestEndMs
}

/** Tonight intervals (nautical dusk→dawn) where this project target is ≥30° — reserved from other queue rows. */
export function projectAltitudeHoldIntervals(
  project: AltitudeHoldProject,
  now = new Date()
): Array<{ startMs: number; endMs: number }> {
  if (remainingFiltersMoonBlockedTonight(project, now)) return []
  const window = getTonightSchedulingWindow(now)
  const startMs = Math.max(now.getTime(), window.nauticalDuskUtc.getTime())
  const endMs = window.nauticalDawnUtc.getTime()
  if (endMs <= startMs) return []
  const intervals = intervalsWhereAltitudeAtOrAbove(
    project.raHours,
    project.decDeg,
    startMs,
    endMs
  )
  const finalEndMs = finalTonightSubSessionEndMs(project, getTonightScheduleStrip(now).nightKey)
  if (finalEndMs == null) return intervals
  return intervals
    .map((interval) => ({ startMs: interval.startMs, endMs: Math.min(interval.endMs, finalEndMs) }))
    .filter((interval) => interval.endMs > interval.startMs)
}

/** Earliest reservation boundary still ahead of `nowMs`; `null` when none remains tonight. */
export function nextProjectReservationStartMs(
  intervals: Array<{ startMs: number; endMs: number }>,
  nowMs: number
): number | null {
  let next: number | null = null
  for (const interval of intervals) {
    if (interval.startMs <= nowMs) continue
    if (next == null || interval.startMs < next) next = interval.startMs
  }
  return next
}

/**
 * True when a session handed out now finishes, plus the overrun margin, before the reservation
 * opens. Estimates are approximations, so a session that would land on the boundary waits instead.
 */
export function sessionFitsBeforeProjectReservation(input: {
  nowMs: number
  estimatedDurationSeconds: number
  reservedStartMs: number | null
}): boolean {
  if (input.reservedStartMs == null) return true
  const finishMs =
    input.nowMs + Math.max(0, input.estimatedDurationSeconds) * 1000 + PROJECT_HOLD_START_MARGIN_MS
  return finishMs <= input.reservedStartMs
}

export async function getScheduleReservedIntervalsForActiveProject(
  now = new Date()
): Promise<Array<{ startMs: number; endMs: number }>> {
  const project = await getActiveProjectForAltitudeHold(now)
  if (!project) return []
  return projectAltitudeHoldIntervals(project, now)
}
