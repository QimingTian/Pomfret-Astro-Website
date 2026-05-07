import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import { altitudeAllowedCoverageMs, firstAltitudeAllowedTimeMs, isAltitudeAllowed } from '@/lib/target-altitude'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { weatherPermittedCoverageMs, weatherCoverageOk, type TimeInterval } from '@/lib/tonight-weather-gate'

export type ScheduleInsight = {
  status: 'scheduled' | 'unscheduled'
  plannedStartIso: string | null
  reasons: string[]
}

/** Same shape as queue rows used for placement (POST + reconcile). */
export type SchedulePendingRow = {
  id: string
  createdAt: string
  raHours?: number | null
  decDeg?: number | null
  exposureSeconds: number
  count: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  estimatedDurationSeconds?: number
  status?: string
  plannedStartIso?: string | null
}

function estimateDurationSeconds(
  req: Pick<
    SchedulePendingRow,
    'exposureSeconds' | 'count' | 'filterPlans' | 'estimatedDurationSeconds'
  >
): number {
  if (typeof req.estimatedDurationSeconds === 'number' && Number.isFinite(req.estimatedDurationSeconds)) {
    return Math.max(60, req.estimatedDurationSeconds)
  }
  const fromPlans =
    Array.isArray(req.filterPlans) && req.filterPlans.length > 0
      ? req.filterPlans.reduce((sum, p) => sum + Number(p.count) * Number(p.exposureSeconds), 0) + 15 * 60
      : Number(req.exposureSeconds) * Number(req.count) + 15 * 60
  return Math.max(60, Math.round(fromPlans))
}

/**
 * Single source of truth for “can this session be placed tonight?” used by POST and reconcile.
 * `targetId` — which row to return insight for. Other pending rows are simulated in submission order.
 */
export function computeScheduleInsight(
  pending: SchedulePendingRow[],
  targetId: string,
  weatherPermittedIntervals: TimeInterval[]
): ScheduleInsight {
  const now = new Date()
  const nowMs = now.getTime()
  const window = getTonightSchedulingWindow(now)
  const windowStartMs = window.nauticalDuskUtc.getTime()
  const deadlineMs = window.nauticalDawnUtc.getTime()
  let freeIntervals: Array<{ startMs: number; endMs: number }> = [
    { startMs: Math.max(nowMs, windowStartMs), endMs: deadlineMs },
  ]
  const ordered = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const queueIndex = ordered.findIndex((r) => r.id === targetId)
  const committedEarlierBeforeTarget = ordered.reduce((acc, r, i) => {
    if (i >= queueIndex || queueIndex < 0) return acc
    if (r.status !== 'scheduled' || r.plannedStartIso == null) return acc
    const t = Date.parse(r.plannedStartIso)
    if (!Number.isFinite(t)) return acc
    return acc + 1
  }, 0)

  for (const r of ordered) {
    if (r.status !== 'scheduled' || r.plannedStartIso == null) continue
    const pStart = Date.parse(r.plannedStartIso)
    if (!Number.isFinite(pStart)) continue
    const pEnd = pStart + estimateDurationSeconds(r) * 1000
    const overlapStart = Math.max(pStart, windowStartMs)
    const overlapEnd = Math.min(pEnd, deadlineMs)
    if (overlapEnd <= overlapStart) continue
    freeIntervals = subtractOccupiedFromFree(freeIntervals, { startMs: overlapStart, endMs: overlapEnd })
  }

  for (let reqIndex = 0; reqIndex < ordered.length; reqIndex += 1) {
    const req = ordered[reqIndex]!
    if (
      req.status === 'scheduled' &&
      req.plannedStartIso != null &&
      Number.isFinite(Date.parse(req.plannedStartIso))
    ) {
      continue
    }
    const durationMs = estimateDurationSeconds(req) * 1000
    const createdMs = Number.isFinite(Date.parse(req.createdAt)) ? Date.parse(req.createdAt) : nowMs
    let placement: { startMs: number; endMs: number } | null = null
    let placementContext:
      | {
          intervalStartMs: number
          baselineStartMs: number
          riseAtMs: number | null
          weatherCoveragePct: number
        }
      | null = null
    let failedByAltitudeRise = 0
    let failedByIntervalLength = 0
    let failedByAltitudeCoverage = 0
    let failedByWeatherCoverage = 0
    const hasRaDec =
      typeof req.raHours === 'number' &&
      Number.isFinite(req.raHours) &&
      typeof req.decDeg === 'number' &&
      Number.isFinite(req.decDeg)

    const tryStartCandidateMs = (
      interval: { startMs: number; endMs: number },
      candidateStartMs: number
    ): {
      startMs: number
      endMs: number
      riseAtMs: number | null
      weatherCoveragePct: number
      baselineStartMs: number
    } | null => {
      const baselineStartMs = Math.max(interval.startMs, createdMs, nowMs, windowStartMs)
      if (candidateStartMs < baselineStartMs) return null
      let startMs = candidateStartMs
      let riseAtMs: number | null = null
      if (hasRaDec) {
        const riseAt = firstAltitudeAllowedTimeMs(req.raHours!, req.decDeg!, startMs, interval.endMs)
        if (riseAt == null) return null
        riseAtMs = riseAt > candidateStartMs ? riseAt : null
        startMs = riseAt
      }
      const endMs = startMs + durationMs
      if (endMs > interval.endMs || endMs > deadlineMs) return null
      const weatherCoveredMs = weatherPermittedCoverageMs(weatherPermittedIntervals, startMs, endMs)
      const weatherCoveragePct = durationMs > 0 ? (weatherCoveredMs / durationMs) * 100 : 0
      if (!weatherCoverageOk(weatherPermittedIntervals, startMs, endMs, 0.8)) return null
      if (hasRaDec) {
        const coveredMs = altitudeAllowedCoverageMs(req.raHours!, req.decDeg!, startMs, endMs)
        if (coveredMs < durationMs * 0.8) return null
      }
      return { startMs, endMs, riseAtMs, weatherCoveragePct, baselineStartMs }
    }

    for (const interval of freeIntervals) {
      const baselineStartMs = Math.max(interval.startMs, createdMs, nowMs, windowStartMs)
      const intervalDeadline = Math.min(interval.endMs, deadlineMs)
      const lastStartMs = intervalDeadline - durationMs
      if (lastStartMs < baselineStartMs) {
        failedByIntervalLength += 1
        continue
      }

      const searchStepMs = 5 * 60 * 1000
      let chosen: ReturnType<typeof tryStartCandidateMs> = null
      for (let cand = baselineStartMs; cand <= lastStartMs; cand += searchStepMs) {
        const trial = tryStartCandidateMs(interval, cand)
        if (trial) {
          chosen = trial
          break
        }
      }

      if (chosen) {
        placement = { startMs: chosen.startMs, endMs: chosen.endMs }
        placementContext = {
          intervalStartMs: interval.startMs,
          baselineStartMs: chosen.baselineStartMs,
          riseAtMs: chosen.riseAtMs,
          weatherCoveragePct: chosen.weatherCoveragePct,
        }
        break
      }

      if (!chosen) {
        let startMs = baselineStartMs
        if (hasRaDec) {
          const riseAt = firstAltitudeAllowedTimeMs(req.raHours!, req.decDeg!, startMs, interval.endMs)
          if (riseAt == null) {
            failedByAltitudeRise += 1
            continue
          }
          startMs = riseAt
        }
        const endMs = startMs + durationMs
        if (endMs > interval.endMs || endMs > deadlineMs) {
          failedByIntervalLength += 1
          continue
        }
        if (!weatherCoverageOk(weatherPermittedIntervals, startMs, endMs, 0.8)) {
          failedByWeatherCoverage += 1
          continue
        }
        if (hasRaDec) {
          const coveredMs = altitudeAllowedCoverageMs(req.raHours!, req.decDeg!, startMs, endMs)
          if (coveredMs < durationMs * 0.8) failedByAltitudeCoverage += 1
        }
      }
    }

    if (req.id === targetId) {
      if (!placement) {
        const reasons: string[] = []
        if (queueIndex > 0) {
          if (committedEarlierBeforeTarget > 0) {
            reasons.push(
              `${committedEarlierBeforeTarget} earlier queued session(s) have a committed scheduled time and reduce the open window before this request.`
            )
          } else {
            reasons.push(
              `${queueIndex} earlier submission(s) in queue before yours. Sessions are tried in submission order; any that do not fit tonight are skipped without consuming time, so a later submission can still use the remaining window.`
            )
          }
        }
        if (createdMs >= deadlineMs) reasons.push('Submitted after nautical-dawn scheduling cutoff.')
        if (failedByAltitudeRise > 0) {
          reasons.push('Target does not rise above 30° in available free intervals.')
        }
        if (failedByAltitudeCoverage > 0) {
          reasons.push('Target altitude coverage is below 80% for required duration in available free intervals.')
        }
        if (failedByIntervalLength > 0) {
          reasons.push('No free interval is long enough to fit session duration before nautical dawn.')
        }
        if (failedByWeatherCoverage > 0) {
          reasons.push('No interval has weather-permitted coverage >= 80% of session duration.')
        }
        if (reasons.length === 0) reasons.push('No schedulable interval satisfies all constraints.')
        return { status: 'unscheduled', plannedStartIso: null, reasons }
      }

      const reasons: string[] = []
      if (queueIndex > 0 && committedEarlierBeforeTarget > 0) {
        reasons.push(
          `Placed after ${committedEarlierBeforeTarget} earlier session(s) with a committed scheduled time tonight.`
        )
      }
      if (placementContext) {
        if (placementContext.intervalStartMs > nowMs) {
          reasons.push(`Earliest free queue slot opens at ${new Date(placementContext.intervalStartMs).toISOString()}.`)
        }
        if (placementContext.riseAtMs != null && placementContext.riseAtMs > placementContext.baselineStartMs) {
          reasons.push(`Target reaches 30° at ${new Date(placementContext.riseAtMs).toISOString()}.`)
        }
        reasons.push(
          `Weather-permitted coverage over session window is ${placementContext.weatherCoveragePct.toFixed(0)}% (required >= 80%).`
        )
      }
      if (typeof req.raHours === 'number' && Number.isFinite(req.raHours) && typeof req.decDeg === 'number' && Number.isFinite(req.decDeg)) {
        const altNow = isAltitudeAllowed(req.raHours, req.decDeg)
        if (!altNow.ok) reasons.push(`Target currently below 30° (${altNow.altitudeDeg.toFixed(1)}°).`)
      }
      if (reasons.length === 0) reasons.push('Scheduled at earliest available slot under current rules.')
      return { status: 'scheduled', plannedStartIso: new Date(placement.startMs).toISOString(), reasons }
    }

    if (!placement) continue
    freeIntervals = subtractOccupiedFromFree(freeIntervals, placement)
  }

  return {
    status: 'unscheduled',
    plannedStartIso: null,
    reasons: ['Could not compute schedule placement for this session.'],
  }
}
