import {
  getBlockingInProgressProject,
  projectHasOpenSessionsForNightKey,
  remainingFramesTotal,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { moonFilterOkAt } from '@/lib/moon-avoidance'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { intervalsWhereAltitudeAtOrAbove } from '@/lib/target-altitude'

const MOON_SAMPLE_STEP_MS = 5 * 60 * 1000

type AltitudeHoldProject = Pick<ImagingProject, 'raHours' | 'decDeg' | 'remainingByFilter'>

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
  return intervalsWhereAltitudeAtOrAbove(project.raHours, project.decDeg, startMs, endMs)
}

export async function getScheduleReservedIntervalsForActiveProject(
  now = new Date()
): Promise<Array<{ startMs: number; endMs: number }>> {
  const project = await getActiveProjectForAltitudeHold(now)
  if (!project) return []
  return projectAltitudeHoldIntervals(project, now)
}
