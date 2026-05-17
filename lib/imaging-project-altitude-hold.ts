import {
  getBlockingInProgressProject,
  remainingFramesTotal,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { intervalsWhereAltitudeAtOrAbove } from '@/lib/target-altitude'

/** In-progress multi-night project whose target-altitude window others must not use. */
export async function getActiveProjectForAltitudeHold(now = new Date()): Promise<ImagingProject | undefined> {
  const active = await getBlockingInProgressProject()
  if (!active || remainingFramesTotal(active) <= 0) return undefined
  return active
}

/** Tonight intervals (nautical dusk→dawn) where this project target is ≥30° — reserved from other queue rows. */
export function projectAltitudeHoldIntervals(
  project: Pick<ImagingProject, 'raHours' | 'decDeg'>,
  now = new Date()
): Array<{ startMs: number; endMs: number }> {
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
