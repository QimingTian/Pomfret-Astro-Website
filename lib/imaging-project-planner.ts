import { appendAuditLog } from '@/lib/imaging-audit-log'
import { projectNightSubId } from '@/lib/imaging-project-ids'
import {
  buildNightNinaJson,
  compactOrphanProjects,
  compactStaleProjectNights,
  getBlockingInProgressProject,
  getDeliverableNight,
  getNextPendingProject,
  getProjectById,
  hasInProgressSessionTonight,
  listProjects,
  nextProjectSessionIndex,
  projectQueueBlockedReason,
  projectSchedulingBlockedReason,
  remainingFramesTotal,
  replaceScheduledSubsForNightKey,
  tonightDurationSecondsFromPlans,
  patchProject,
  type FilterPlanRow,
  type FilterRemainingRow,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { projectAltitudeHoldIntervals } from '@/lib/imaging-project-altitude-hold'
import { patchRequestScheduleInsight } from '@/lib/imaging-queue-store'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import {
  altitudeAllowedCoverageMs,
  altitudeSessionCoverageOk,
  currentAltitudeDeg,
  firstAltitudeAllowedTimeMs,
} from '@/lib/target-altitude'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  weatherCoverageOk,
  weatherPermittedCoverageMs,
  type TimeInterval,
} from '@/lib/tonight-weather-gate'

export type ProjectTonightPlan = {
  nightKey: string
  nightIndex: number
  filterPlansTonight: FilterPlanRow[]
  plannedStartIso: string
  plannedEndIso: string
  durationSeconds: number
  scheduleReasons: string[]
}

const SESSION_OVERHEAD_MS = 15 * 60 * 1000
const PLACEMENT_STEP_MS = 5 * 60 * 1000
const SCHEDULE_LOG_TZ = 'America/New_York'

function formatScheduleEt(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: SCHEDULE_LOG_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatScheduleEtRange(startMs: number, endMs: number): string {
  return `${formatScheduleEt(startMs)} – ${formatScheduleEt(endMs)} ET`
}

function formatWeatherPermittedSpansForRun(
  startMs: number,
  endMs: number,
  weatherPermittedIntervals: TimeInterval[]
): string {
  const spans: string[] = []
  for (const iv of weatherPermittedIntervals) {
    const overlapStart = Math.max(startMs, iv.startMs)
    const overlapEnd = Math.min(endMs, iv.endMs)
    if (overlapEnd > overlapStart) {
      spans.push(formatScheduleEtRange(overlapStart, overlapEnd))
    }
  }
  return spans.length > 0 ? spans.join('; ') : 'none'
}

function buildProjectSubSessionScheduleReasons(input: {
  project: ImagingProject
  cursorMs: number
  planningEndMs: number
  placedStart: number
  placedEnd: number
  finalPlans: FilterPlanRow[]
  workingRemainingBefore: FilterRemainingRow[]
  weatherPermittedIntervals: TimeInterval[]
  nowMs: number
  windowStartMs: number
  deadlineMs: number
}): string[] {
  const {
    project,
    cursorMs,
    planningEndMs,
    placedStart,
    placedEnd,
    finalPlans,
    workingRemainingBefore,
    weatherPermittedIntervals,
    nowMs,
    windowStartMs,
    deadlineMs,
  } = input
  const reasons: string[] = []
  const createdMs = Number.isFinite(Date.parse(project.createdAt))
    ? Date.parse(project.createdAt)
    : nowMs
  const durationMs = placedEnd - placedStart

  reasons.push(
    `Weather-permitted segments overlapping this run: ${formatWeatherPermittedSpansForRun(placedStart, placedEnd, weatherPermittedIntervals)}.`
  )

  const frameParts = finalPlans.map((p) => `${p.filterName} ${p.count}×${p.exposureSeconds}s`)
  const frameTotal = finalPlans.reduce((s, p) => s + p.count, 0)
  reasons.push(`Frames in this session: ${frameParts.join(', ')} (${frameTotal} exposure(s) total).`)

  const altAtStart = currentAltitudeDeg(project.raHours, project.decDeg, new Date(placedStart))
  const riseAt = firstAltitudeAllowedTimeMs(
    project.raHours,
    project.decDeg,
    cursorMs,
    planningEndMs
  )
  if (riseAt != null && riseAt > placedStart + 60_000) {
    reasons.push(
      `Start at ${formatScheduleEt(placedStart)} ET: target reaches 30° altitude at ${formatScheduleEt(riseAt)} ET (now ${altAtStart.toFixed(1)}° at start).`
    )
  } else {
    reasons.push(
      `Start at ${formatScheduleEt(placedStart)} ET: target at ${altAtStart.toFixed(1)}° (≥30° required).`
    )
  }

  const earliestMs = Math.max(cursorMs, createdMs, nowMs, windowStartMs)
  if (placedStart > earliestMs + 5 * 60_000) {
    reasons.push(
      `Not placed at ${formatScheduleEt(earliestMs)} ET: waiting for target altitude, ≥80% weather-permitted coverage, or a long enough free interval.`
    )
  }

  const virtualProject: ImagingProject = { ...project, remainingByFilter: workingRemainingBefore }
  const maxPack = planTonightFilterFrames(virtualProject, cursorMs, planningEndMs, workingRemainingBefore)
  const maxFrames = maxPack.filterPlansTonight.reduce((s, p) => s + p.count, 0)
  if (frameTotal < maxFrames) {
    reasons.push(
      'Fewer frames than the free window could fit: placement requires ≥80% weather-permitted and 100% target-altitude (≥30°) coverage for the full run (may span multiple clear spells).'
    )
  }

  const exposureMs = finalPlans.reduce((s, p) => s + p.count * p.exposureSeconds, 0) * 1000
  reasons.push(
    `End at ${formatScheduleEt(placedEnd)} ET: ${(exposureMs / 3600000).toFixed(2)} h exposure + 15 min session overhead (${(durationMs / 3600000).toFixed(2)} h block).`
  )

  if (placedEnd >= planningEndMs - 2 * 60_000) {
    reasons.push('End aligned with the end of the available free scheduling window.')
  }
  if (placedEnd >= deadlineMs - 2 * 60_000) {
    reasons.push('End limited by nautical-dawn scheduling deadline.')
  }

  const weatherPct =
    durationMs > 0
      ? (weatherPermittedCoverageMs(weatherPermittedIntervals, placedStart, placedEnd) / durationMs) * 100
      : 0
  const altPct = durationMs > 0 ? (altitudeAllowedCoverageMs(project.raHours, project.decDeg, placedStart, placedEnd) / durationMs) * 100 : 0
  reasons.push(
    `Coverage checks: weather-permitted ${weatherPct.toFixed(0)}% (≥80% required), target ≥30° ${altPct.toFixed(0)}% (100% required).`
  )

  return reasons
}

function scheduledSubScheduleFingerprint(
  plannedStartIso: string | null | undefined,
  filterPlansTonight: FilterPlanRow[] | undefined
): string {
  const plans = filterPlansTonight ?? []
  return `${plannedStartIso ?? ''}|${tonightDurationSecondsFromPlans(plans)}|${JSON.stringify(plans)}`
}

/** Fill a time window in filter order (cap each filter by remaining count). */
export function planTonightFilterFrames(
  project: ImagingProject,
  usableStartMs: number,
  usableEndMs: number,
  remainingByFilter?: FilterRemainingRow[]
): { filterPlansTonight: FilterPlanRow[]; durationMs: number } {
  const remaining = remainingByFilter ?? project.remainingByFilter
  const filterPlansTonight: FilterPlanRow[] = []
  let cursorMs = usableStartMs

  for (const total of project.filterPlansTotal) {
    const row = remaining.find((r) => r.filterName === total.filterName)
    const countRemaining = row?.countRemaining ?? 0
    if (countRemaining <= 0) continue

    const exposureMs = total.exposureSeconds * 1000
    const windowMs = Math.max(0, usableEndMs - cursorMs)
    if (windowMs < exposureMs + SESSION_OVERHEAD_MS) break

    const maxFrames = Math.floor((windowMs - SESSION_OVERHEAD_MS) / exposureMs)
    const framesTonight = Math.min(countRemaining, maxFrames)
    if (framesTonight <= 0) continue

    filterPlansTonight.push({
      filterName: total.filterName,
      exposureSeconds: total.exposureSeconds,
      count: framesTonight,
    })
    cursorMs += framesTonight * exposureMs
  }

  const durationMs =
    filterPlansTonight.reduce((s, p) => s + p.count * p.exposureSeconds, 0) * 1000 + SESSION_OVERHEAD_MS
  return { filterPlansTonight, durationMs }
}

function minExposureMs(project: ImagingProject): number {
  let min = Infinity
  for (const p of project.filterPlansTotal) {
    if (p.exposureSeconds > 0) min = Math.min(min, p.exposureSeconds * 1000)
  }
  return Number.isFinite(min) ? min : 60_000
}

function shrinkFilterPlansByOneFrame(plans: FilterPlanRow[]): FilterPlanRow[] | null {
  for (let i = plans.length - 1; i >= 0; i--) {
    const row = plans[i]!
    if (row.count > 1) {
      return plans.map((p, j) => (j === i ? { ...p, count: p.count - 1 } : p))
    }
  }
  if (plans.length <= 1) return null
  return plans.slice(0, -1)
}

function subtractRemaining(
  remaining: FilterRemainingRow[],
  shot: FilterPlanRow[]
): FilterRemainingRow[] {
  return remaining.map((r) => {
    const used = shot.find((p) => p.filterName === r.filterName)
    if (!used) return r
    return {
      ...r,
      countRemaining: Math.max(0, r.countRemaining - used.count),
    }
  })
}

function intersectTimeIntervals(
  a: TimeInterval,
  b: { startMs: number; endMs: number }
): TimeInterval | null {
  const startMs = Math.max(a.startMs, b.startMs)
  const endMs = Math.min(a.endMs, b.endMs)
  if (endMs <= startMs) return null
  return { startMs, endMs }
}

/** Free queue slices inside [windowStartMs, windowEndMs] long enough to place a session. */
function freeSlicesInWindow(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  windowStartMs: number,
  windowEndMs: number,
  minWindowMs: number
): TimeInterval[] {
  const out: TimeInterval[] = []
  for (const free of freeIntervals) {
    const hit = intersectTimeIntervals(free, { startMs: windowStartMs, endMs: windowEndMs })
    if (hit && hit.endMs - hit.startMs >= minWindowMs) out.push(hit)
  }
  out.sort((a, b) => a.startMs - b.startMs)
  return out
}

/** Merge hourly (or overlapping) weather segments into continuous clear spells. */
export function mergeAdjacentIntervals(
  intervals: TimeInterval[],
  maxGapMs = 60_000
): TimeInterval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs)
  const merged: TimeInterval[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = merged[merged.length - 1]!
    if (cur.startMs <= last.endMs + maxGapMs) {
      last.endMs = Math.max(last.endMs, cur.endMs)
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

/** Weather-permitted windows for tonight, clipped to nautical dusk→dawn and free queue intervals. */
export function buildTonightWeatherWindows(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  windowStartMs: number,
  deadlineMs: number,
  minWindowMs: number
): TimeInterval[] {
  const out: TimeInterval[] = []
  for (const weather of weatherPermittedIntervals) {
    const w = intersectTimeIntervals(weather, { startMs: windowStartMs, endMs: deadlineMs })
    if (!w || w.endMs - w.startMs < minWindowMs) continue
    for (const free of freeIntervals) {
      const hit = intersectTimeIntervals(w, free)
      if (hit && hit.endMs - hit.startMs >= minWindowMs) out.push(hit)
    }
  }
  out.sort((a, b) => a.startMs - b.startMs)
  return mergeAdjacentIntervals(out)
}

function findPlacementStart(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  durationMs: number,
  weatherPermittedIntervals: TimeInterval[],
  nowMs: number,
  windowStartMs: number,
  deadlineMs: number
): number | null {
  const createdMs = Number.isFinite(Date.parse(project.createdAt))
    ? Date.parse(project.createdAt)
    : nowMs

  for (const interval of freeIntervals) {
    const baselineStartMs = Math.max(interval.startMs, createdMs, nowMs, windowStartMs)
    const lastStartMs = Math.min(interval.endMs, deadlineMs) - durationMs
    if (lastStartMs < baselineStartMs) continue

    for (let cand = baselineStartMs; cand <= lastStartMs; cand += PLACEMENT_STEP_MS) {
      let startMs = cand
      const riseAt = firstAltitudeAllowedTimeMs(
        project.raHours,
        project.decDeg,
        startMs,
        Math.min(interval.endMs, deadlineMs)
      )
      if (riseAt == null) continue
      startMs = riseAt
      const endMs = startMs + durationMs
      if (endMs > interval.endMs || endMs > deadlineMs) continue
      if (!weatherCoverageOk(weatherPermittedIntervals, startMs, endMs, 0.8)) continue
      if (!altitudeSessionCoverageOk(project.raHours, project.decDeg, startMs, endMs)) continue
      return startMs
    }
  }
  return null
}

/** Place one sub-session in free time; may span multiple clear spells when ≥80% weather coverage holds. */
function placeSubSessionInFreeWindow(
  virtualProject: ImagingProject,
  usableFree: TimeInterval[],
  cursorMs: number,
  planningEndMs: number,
  workingRemaining: FilterRemainingRow[],
  weatherPermittedIntervals: TimeInterval[],
  nowMs: number,
  windowStartMs: number,
  deadlineMs: number
): { finalPlans: FilterPlanRow[]; placedStart: number; actualDurationMs: number } | null {
  let { filterPlansTonight: draftPlans } = planTonightFilterFrames(
    virtualProject,
    cursorMs,
    planningEndMs,
    workingRemaining
  )
  if (draftPlans.length === 0) return null

  for (let attempt = 0; attempt < 400; attempt++) {
    const durationMs = tonightDurationSecondsFromPlans(draftPlans) * 1000
    const startMs = findPlacementStart(
      virtualProject,
      usableFree,
      durationMs,
      weatherPermittedIntervals,
      nowMs,
      windowStartMs,
      deadlineMs
    )
    if (startMs == null) {
      const shrunk = shrinkFilterPlansByOneFrame(draftPlans)
      if (!shrunk) return null
      draftPlans = shrunk
      continue
    }

    const { filterPlansTonight: finalPlans } = planTonightFilterFrames(
      virtualProject,
      startMs,
      Math.min(startMs + durationMs, planningEndMs, deadlineMs),
      workingRemaining
    )
    if (finalPlans.length === 0) {
      const shrunk = shrinkFilterPlansByOneFrame(draftPlans)
      if (!shrunk) return null
      draftPlans = shrunk
      continue
    }

    const actualDurationMs = tonightDurationSecondsFromPlans(finalPlans) * 1000
    const refinedStart = findPlacementStart(
      virtualProject,
      usableFree,
      actualDurationMs,
      weatherPermittedIntervals,
      nowMs,
      windowStartMs,
      deadlineMs
    )
    const placedStart = refinedStart ?? startMs
    return {
      finalPlans,
      placedStart,
      actualDurationMs: tonightDurationSecondsFromPlans(finalPlans) * 1000,
    }
  }
  return null
}

function hasSchedulableFreeTonight(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  windowStartMs: number,
  deadlineMs: number,
  minWindowMs: number
): boolean {
  for (const free of freeIntervals) {
    const startMs = Math.max(free.startMs, windowStartMs)
    const endMs = Math.min(free.endMs, deadlineMs)
    if (endMs - startMs < minWindowMs) continue
    if (weatherPermittedCoverageMs(weatherPermittedIntervals, startMs, endMs) >= minWindowMs) {
      return true
    }
  }
  return false
}

/** One sub-session plan per schedulable free interval tonight (global session indices). */
export function planTonightSubSessions(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): ProjectTonightPlan[] {
  if (remainingFramesTotal(project) <= 0) return []

  const nowMs = now.getTime()
  const window = getTonightSchedulingWindow(now)
  const windowStartMs = window.nauticalDuskUtc.getTime()
  const deadlineMs = window.nauticalDawnUtc.getTime()
  const strip = getTonightScheduleStrip(now)
  const minWindowMs = minExposureMs(project) + SESSION_OVERHEAD_MS

  if (!hasSchedulableFreeTonight(freeIntervals, weatherPermittedIntervals, windowStartMs, deadlineMs, minWindowMs)) {
    return []
  }

  let workingRemaining = project.remainingByFilter.map((r) => ({ ...r }))
  let sessionIndex = nextProjectSessionIndex(project)
  const plans: ProjectTonightPlan[] = []
  let workingFree = [...freeIntervals].sort((a, b) => a.startMs - b.startMs)
  let globalCursorMs = Math.max(nowMs, windowStartMs)

  while (true) {
    const framesLeft = workingRemaining.reduce((s, r) => s + r.countRemaining, 0)
    if (framesLeft <= 0) break

    let best: {
      finalPlans: FilterPlanRow[]
      placedStart: number
      actualDurationMs: number
      cursorMs: number
      planningEndMs: number
    } | null = null

    for (const free of workingFree) {
      const cursorMs = Math.max(free.startMs, globalCursorMs)
      const planningEndMs = Math.min(free.endMs, deadlineMs)
      if (planningEndMs - cursorMs < minWindowMs) continue

      const virtualProject: ImagingProject = { ...project, remainingByFilter: workingRemaining }
      const placed = placeSubSessionInFreeWindow(
        virtualProject,
        [{ startMs: cursorMs, endMs: free.endMs }],
        cursorMs,
        planningEndMs,
        workingRemaining,
        weatherPermittedIntervals,
        nowMs,
        windowStartMs,
        deadlineMs
      )
      if (!placed) continue
      if (!best || placed.placedStart < best.placedStart) {
        best = { ...placed, cursorMs, planningEndMs }
      }
    }

    if (!best) break

    const { finalPlans, placedStart, actualDurationMs, cursorMs, planningEndMs } = best
    const placedEnd = placedStart + actualDurationMs
    const remainingBefore = workingRemaining.map((r) => ({ ...r }))

    plans.push({
      nightKey: strip.nightKey,
      nightIndex: sessionIndex++,
      filterPlansTonight: finalPlans,
      plannedStartIso: new Date(placedStart).toISOString(),
      plannedEndIso: new Date(placedEnd).toISOString(),
      durationSeconds: tonightDurationSecondsFromPlans(finalPlans),
      scheduleReasons: buildProjectSubSessionScheduleReasons({
        project,
        cursorMs,
        planningEndMs,
        placedStart,
        placedEnd,
        finalPlans,
        workingRemainingBefore: remainingBefore,
        weatherPermittedIntervals,
        nowMs,
        windowStartMs,
        deadlineMs,
      }),
    })

    workingRemaining = subtractRemaining(workingRemaining, finalPlans)
    workingFree = subtractOccupiedFromFree(workingFree, {
      startMs: placedStart,
      endMs: placedEnd,
    })
    globalCursorMs = Math.max(globalCursorMs, placedEnd)
  }

  return plans
}

/** @deprecated Use planTonightSubSessions; returns first plan if any. */
export function computeProjectTonightPlan(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): ProjectTonightPlan | null {
  const plans = planTonightSubSessions(project, freeIntervals, weatherPermittedIntervals, now)
  return plans[0] ?? null
}

function shouldRefreshTonightSubs(project: ImagingProject, nightKey: string): boolean {
  const tonight = project.nights.filter((n) => n.nightKey === nightKey)
  if (tonight.length === 0) return true
  // Do not reshuffle later `scheduled` subs while one is imaging — avoids Session 2 sliding on the strip.
  if (hasInProgressSessionTonight(project, nightKey)) return false
  // Re-plan or clear `scheduled` subs when weather changes. in_progress/completed are kept by replaceScheduledSubsForNightKey.
  if (
    tonight.some(
      (n) => n.status === 'scheduled' || n.status === 'failed' || n.status === 'planned'
    )
  ) {
    return true
  }
  if (
    tonight.every((n) => n.status === 'completed' || n.status === 'failed') &&
    remainingFramesTotal(project) > 0
  ) {
    return true
  }
  return false
}

function subtractProjectSubsTonight(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  nightKey: string,
  statuses: Array<'scheduled' | 'in_progress'>
): Array<{ startMs: number; endMs: number }> {
  let free = freeIntervals
  for (const n of project.nights) {
    if (n.nightKey !== nightKey) continue
    if (n.status !== 'scheduled' && n.status !== 'in_progress') continue
    if (!statuses.includes(n.status)) continue
    if (!n.plannedStartIso) continue
    const startMs = Date.parse(n.plannedStartIso)
    if (!Number.isFinite(startMs)) continue
    const endMs = startMs + tonightDurationSecondsFromPlans(n.filterPlansTonight) * 1000
    if (endMs <= startMs) continue
    free = subtractOccupiedFromFree(free, { startMs, endMs })
  }
  return free
}

function subtractInProgressSubsTonight(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  nightKey: string
): Array<{ startMs: number; endMs: number }> {
  return subtractProjectSubsTonight(project, freeIntervals, nightKey, ['in_progress'])
}

/** Free time for the next pending project while another project is in progress (≥30° windows reserved for active target). */
export function plannerFreeIntervalsBehindInProgressProject(
  active: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  nightKey: string,
  now = new Date()
): Array<{ startMs: number; endMs: number }> {
  let free = freeIntervals
  for (const hold of projectAltitudeHoldIntervals(active, now)) {
    free = subtractOccupiedFromFree(free, hold)
  }
  return subtractProjectSubsTonight(active, free, nightKey, ['scheduled', 'in_progress'])
}

function hasScheduledSubsTonight(project: ImagingProject, nightKey: string): boolean {
  return project.nights.some((n) => n.nightKey === nightKey && n.status === 'scheduled')
}

async function applyTonightPlansOrClearScheduled(
  projectId: string,
  nightKey: string,
  plans: ProjectTonightPlan[]
): Promise<void> {
  if (plans.length > 0) {
    await applyProjectTonightPlans(projectId, plans)
    return
  }
  const project = await getProjectById(projectId)
  if (!project || !hasScheduledSubsTonight(project, nightKey)) return
  // Keep deliverable scheduled subs when replan is briefly empty (stuck in_progress, API flicker).
  if (hasInProgressSessionTonight(project, nightKey)) return
  if (getDeliverableNight(project)) return
  await replaceScheduledSubsForNightKey(projectId, nightKey, [])
}

export type ProjectScheduleInsight = {
  status: 'scheduled' | 'unscheduled'
  plannedStartIso: string | null
  reasons: string[]
}

export function explainWhyNoPlansTonight(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): string[] {
  if (remainingFramesTotal(project) <= 0) return ['Project has no remaining frames.']

  const nowMs = now.getTime()
  const window = getTonightSchedulingWindow(now)
  const windowStartMs = window.nauticalDuskUtc.getTime()
  const deadlineMs = window.nauticalDawnUtc.getTime()
  const minWindowMs = minExposureMs(project) + SESSION_OVERHEAD_MS
  if (!hasSchedulableFreeTonight(freeIntervals, weatherPermittedIntervals, windowStartMs, deadlineMs, minWindowMs)) {
    return [
      'No weather-permitted window overlaps nautical dusk–dawn tonight (after queue free time).',
    ]
  }

  const reasons: string[] = []
  let workingRemaining = project.remainingByFilter.map((r) => ({ ...r }))
  let globalCursorMs = Math.max(nowMs, windowStartMs)
  const sortedFree = [...freeIntervals].sort((a, b) => a.startMs - b.startMs)

  for (let i = 0; i < sortedFree.length; i++) {
    const free = sortedFree[i]!
    const cursorMs = Math.max(free.startMs, globalCursorMs)
    const planningEndMs = Math.min(free.endMs, deadlineMs)
    const label = `Free interval ${i + 1} (${new Date(cursorMs).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}–${new Date(planningEndMs).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET)`
    const framesLeft = workingRemaining.reduce((s, r) => s + r.countRemaining, 0)
    if (framesLeft <= 0) break
    if (planningEndMs - cursorMs < minWindowMs) continue

    const virtualProject: ImagingProject = { ...project, remainingByFilter: workingRemaining }
    const { filterPlansTonight: draftPlans } = planTonightFilterFrames(
      virtualProject,
      cursorMs,
      planningEndMs,
      workingRemaining
    )
    if (draftPlans.length === 0) {
      reasons.push(`${label}: interval too short for one exposure plus session overhead.`)
      continue
    }

    const durationMs = tonightDurationSecondsFromPlans(draftPlans) * 1000
    const riseAt = firstAltitudeAllowedTimeMs(project.raHours, project.decDeg, cursorMs, planningEndMs)
    if (riseAt == null) {
      const altAtStart = currentAltitudeDeg(project.raHours, project.decDeg, new Date(cursorMs))
      reasons.push(
        `${label}: target stays below 30° altitude (about ${altAtStart.toFixed(0)}° at interval start).`
      )
      continue
    }

    const startMs = findPlacementStart(
      virtualProject,
      [{ startMs: cursorMs, endMs: free.endMs }],
      durationMs,
      weatherPermittedIntervals,
      nowMs,
      windowStartMs,
      deadlineMs
    )
    if (startMs == null) {
      const windowH = ((planningEndMs - cursorMs) / 3600000).toFixed(1)
      const needH = (durationMs / 3600000).toFixed(1)
      const frames = draftPlans.reduce((s, p) => s + p.count, 0)
      reasons.push(
        `${label}: cannot place ${frames} frame(s) (~${needH} h with overhead) in ${windowH} h free (weather ≥80%, altitude 100%; may span multiple clear spells).`
      )
      continue
    }

    workingRemaining = subtractRemaining(workingRemaining, draftPlans)
    globalCursorMs = Math.max(globalCursorMs, startMs + durationMs)
  }

  if (reasons.length === 0) {
    return ['No schedulable slot tonight for the next project session (weather, altitude, or window).']
  }
  return reasons
}

export function computeProjectScheduleInsight(
  project: ImagingProject,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): ProjectScheduleInsight {
  const plans = planTonightSubSessions(project, freeIntervals, weatherPermittedIntervals, now)
  if (plans.length === 0) {
    return {
      status: 'unscheduled',
      plannedStartIso: null,
      reasons: explainWhyNoPlansTonight(project, freeIntervals, weatherPermittedIntervals, now),
    }
  }
  const totalFrames = plans.reduce(
    (s, p) => s + p.filterPlansTonight.reduce((t, f) => t + f.count, 0),
    0
  )
  return {
    status: 'scheduled',
    plannedStartIso: plans[0]!.plannedStartIso,
    reasons: [
      `Project: ${plans.length} session(s) tonight (${totalFrames} frame(s)); remaining frames carry to later nights.`,
    ],
  }
}

function filterPlansFingerprint(filterPlansTonight: FilterPlanRow[]): string {
  return JSON.stringify(filterPlansTonight)
}

/** Frame plan only — planned start may move with reconcile without rewriting NINA JSON. */
function subSessionScheduleFingerprint(input: { filterPlansTonight: FilterPlanRow[] }): string {
  return filterPlansFingerprint(input.filterPlansTonight)
}

function logProjectSubSessionScheduled(
  project: ImagingProject,
  plan: ProjectTonightPlan,
  nightSubId: string
): void {
  void appendAuditLog({
    kind: 'project.sub_session_scheduled',
    message: `Project sub-session scheduled: ${project.target} Session ${plan.nightIndex} (${nightSubId}).`,
    detail: {
      projectId: project.id,
      nightSubId,
      nightIndex: plan.nightIndex,
      nightKey: plan.nightKey,
      target: project.target,
      plannedStartIso: plan.plannedStartIso,
      plannedEndIso: plan.plannedEndIso,
      filterPlansTonight: plan.filterPlansTonight,
      reasons: plan.scheduleReasons,
    },
  })
}

function plansToScheduledNights(
  project: ImagingProject,
  plans: ProjectTonightPlan[]
): ProjectNight[] {
  const nightKey = plans[0]?.nightKey
  if (!nightKey) return []
  const existingScheduled = project.nights
    .filter((n) => n.nightKey === nightKey && n.status === 'scheduled')
    .sort((a, b) => {
      const ta = Date.parse(a.plannedStartIso ?? '')
      const tb = Date.parse(b.plannedStartIso ?? '')
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb
      return a.nightIndex - b.nightIndex
    })
  return plans.map((plan, i) => {
    const reuse = existingScheduled[i]
    const nightIndex = reuse?.nightIndex ?? plan.nightIndex
    const nightId = reuse?.id ?? projectNightSubId(project.id, nightIndex)
    const sameFrames =
      reuse != null &&
      filterPlansFingerprint(reuse.filterPlansTonight) === filterPlansFingerprint(plan.filterPlansTonight)
    const reuseStartMs = reuse?.plannedStartIso ? Date.parse(reuse.plannedStartIso) : NaN
    const plannedStartIso =
      sameFrames && Number.isFinite(reuseStartMs) ? reuse.plannedStartIso! : plan.plannedStartIso
    return {
      id: nightId,
      nightKey: plan.nightKey,
      nightIndex,
      status: 'scheduled' as const,
      filterPlansTonight: plan.filterPlansTonight,
      ninaSequenceJson: buildNightNinaJson(project, nightId, plan.filterPlansTonight),
      plannedStartIso,
    }
  })
}

export function subtractProjectTonightPlansFromFree(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  plans: ProjectTonightPlan[]
): Array<{ startMs: number; endMs: number }> {
  let free = freeIntervals
  for (const plan of plans) {
    const startMs = Date.parse(plan.plannedStartIso)
    if (!Number.isFinite(startMs)) continue
    const endMs = startMs + plan.durationSeconds * 1000
    if (endMs <= startMs) continue
    free = subtractOccupiedFromFree(free, { startMs, endMs })
  }
  return free
}

/** Persist all tonight sub-session plans; promote project to in_progress when any are written. */
export async function applyProjectTonightPlans(
  projectId: string,
  plans: ProjectTonightPlan[]
): Promise<void> {
  if (plans.length === 0) return
  const project = await getProjectById(projectId)
  if (!project) return
  const nightKey = plans[0]!.nightKey
  const prevScheduled = new Map(
    project.nights
      .filter((n) => n.nightKey === nightKey && n.status === 'scheduled')
      .map((n) => [n.id, subSessionScheduleFingerprint({ filterPlansTonight: n.filterPlansTonight })])
  )
  const subs = plansToScheduledNights(project, plans)
  await replaceScheduledSubsForNightKey(projectId, nightKey, subs)
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!
    const sub = subs[i]
    if (!sub) continue
    const nextFp = subSessionScheduleFingerprint({ filterPlansTonight: plan.filterPlansTonight })
    if (prevScheduled.get(sub.id) === nextFp) continue
    logProjectSubSessionScheduled(project, { ...plan, nightIndex: sub.nightIndex }, sub.id)
  }
  const refreshed = await getProjectById(projectId)
  if (refreshed && (refreshed.status === 'pending' || refreshed.status === 'scheduled')) {
    await patchProject(projectId, { status: 'in_progress' })
  }
}

/** @deprecated Use applyProjectTonightPlans */
export async function applyProjectTonightPlan(
  projectId: string,
  plan: ProjectTonightPlan
): Promise<void> {
  await applyProjectTonightPlans(projectId, [plan])
}

/** Compute insight, persist tonight's sub-sessions, and promote project to in_progress when schedulable. */
export async function planAndScheduleProjectTonight(
  projectId: string,
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): Promise<ProjectScheduleInsight> {
  const project = await getProjectById(projectId)
  if (!project) {
    return {
      status: 'unscheduled',
      plannedStartIso: null,
      reasons: ['Project record not found.'],
    }
  }
  const blocker = await getBlockingInProgressProject(projectId)
  if (blocker) {
    return {
      status: 'unscheduled',
      plannedStartIso: null,
      reasons: [projectSchedulingBlockedReason(blocker)],
    }
  }
  const queueHead = getNextPendingProject(await listProjects())
  if (queueHead && queueHead.id !== projectId) {
    return {
      status: 'unscheduled',
      plannedStartIso: null,
      reasons: [projectQueueBlockedReason(queueHead)],
    }
  }
  const insight = computeProjectScheduleInsight(
    project,
    freeIntervals,
    weatherPermittedIntervals,
    now
  )
  if (insight.status !== 'scheduled') return insight

  const strip = getTonightScheduleStrip(now)
  const plans = planTonightSubSessions(project, freeIntervals, weatherPermittedIntervals, now)
  if (plans.length === 0) return insight

  if (shouldRefreshTonightSubs(project, strip.nightKey)) {
    await applyProjectTonightPlans(projectId, plans)
  }
  return insight
}

export async function reconcileOneProjectTonight(
  project: ImagingProject,
  projectFree: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  nightKey: string,
  now: Date
): Promise<ProjectTonightPlan[]> {
  const plannerFree = subtractInProgressSubsTonight(project, projectFree, nightKey)
  const plans = planTonightSubSessions(project, plannerFree, weatherPermittedIntervals, now)
  const insight =
    plans.length > 0
      ? {
          status: 'scheduled' as const,
          plannedStartIso: plans[0]!.plannedStartIso,
          reasons: [
            `Multi-night project: ${plans.length} session(s) tonight (${plans.reduce((s, p) => s + p.filterPlansTonight.reduce((t, f) => t + f.count, 0), 0)} frame(s)).`,
          ],
        }
      : {
          status: 'unscheduled' as const,
          plannedStartIso: null,
          reasons: ['Project could not be scheduled for tonight; will retry on a later night.'],
        }

  await patchRequestScheduleInsight(project.id, insight)

  if (shouldRefreshTonightSubs(project, nightKey)) {
    await applyTonightPlansOrClearScheduled(project.id, nightKey, plans)
  }

  return plans
}

/** Refresh tonight sub-sessions for the one in-progress project (full night; not altitude-gapped). */
export async function reconcileActiveInProgressProjectTonight(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): Promise<ImagingProject | undefined> {
  await compactStaleProjectNights()
  await compactOrphanProjects()
  let projects = await listProjects()
  const nightKey = getTonightScheduleStrip(now).nightKey

  const inProgressRows = projects
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (inProgressRows.length > 1) {
    for (const extra of inProgressRows.slice(1)) {
      await patchProject(extra.id, { status: 'pending' })
    }
    projects = await listProjects()
  }

  const onBoard = projects.find((p) => p.status === 'in_progress' && p.onBoard)
  const blocker = onBoard ?? (await getBlockingInProgressProject())
  const active = onBoard ?? blocker
  if (!active || remainingFramesTotal(active) <= 0) return undefined

  const activeFree = subtractInProgressSubsTonight(active, freeIntervals, nightKey)
  await reconcileOneProjectTonight(active, activeFree, weatherPermittedIntervals, nightKey, now)
  return active
}

/** Reconcile in-progress project own subs only; queue FIFO runs in reconcilePendingScheduleStatus. */
export async function reconcileProjectSchedules(
  freeIntervals: Array<{ startMs: number; endMs: number }>,
  weatherPermittedIntervals: TimeInterval[],
  now = new Date()
): Promise<void> {
  await reconcileActiveInProgressProjectTonight(freeIntervals, weatherPermittedIntervals, now)
}
