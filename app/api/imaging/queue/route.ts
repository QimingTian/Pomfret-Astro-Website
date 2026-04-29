import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  imagingCorsOptions,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import {
  createRequest,
  deleteRequestById,
  listAll,
  listPending,
  patchRequestScheduleInsight,
  toPublicImagingRequest,
  type CreateImagingInput,
} from '@/lib/imaging-queue-store'
import { getObservatoryStatus, isObservatoryReady } from '@/lib/observatory-status-store'
import { altitudeAllowedCoverageMs, firstAltitudeAllowedTimeMs, isAltitudeAllowed } from '@/lib/target-altitude'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  getTonightWeatherPermittedIntervals,
  weatherPermittedCoverageMs,
  weatherCoverageOk,
  type TimeInterval,
} from '@/lib/tonight-weather-gate'

export const runtime = 'nodejs'

type ScheduleInsight = {
  status: 'scheduled' | 'unscheduled'
  plannedStartIso: string | null
  reasons: string[]
}

function estimateDurationSeconds(
  req: Pick<CreateImagingInput, 'exposureSeconds' | 'count' | 'filterPlans'> & { estimatedDurationSeconds?: number }
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

async function detectSunsetSunrisePrecipGate(): Promise<{ active: boolean | null; hitHours: number[] }> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=41.9159&longitude=-71.9626' +
    '&hourly=precipitation_probability' +
    '&daily=sunrise,sunset' +
    '&forecast_days=2&timezone=America/New_York&timeformat=unixtime'
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { active: null, hitHours: [] }
    const data = (await res.json()) as {
      hourly?: { time?: number[]; precipitation_probability?: number[] }
      daily?: { sunrise?: number[]; sunset?: number[] }
    }
    const times = data.hourly?.time ?? []
    const precip = data.hourly?.precipitation_probability ?? []
    const sunset = data.daily?.sunset?.[0]
    const sunrise = data.daily?.sunrise?.[1]
    if (
      !Number.isFinite(sunset) ||
      !Number.isFinite(sunrise) ||
      times.length === 0 ||
      precip.length !== times.length ||
      Number(sunrise) <= Number(sunset)
    ) {
      return { active: null, hitHours: [] }
    }
    const sunsetSec = Number(sunset)
    const sunriseSec = Number(sunrise)
    const hitHours = times.filter((t, i) => t >= sunsetSec && t < sunriseSec && Number(precip[i]) >= 10)
    return { active: hitHours.length > 0, hitHours }
  } catch {
    return { active: null, hitHours: [] }
  }
}

function computeScheduleInsight(
  pending: Array<{
    id: string
    createdAt: string
    raHours?: number | null
    decDeg?: number | null
    exposureSeconds: number
    count: number
    filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
    estimatedDurationSeconds?: number
  }>,
  targetId: string,
  weatherPermittedIntervals: TimeInterval[]
): ScheduleInsight {
  const now = new Date()
  const nowMs = now.getTime()
  const window = getTonightSchedulingWindow(now)
  const windowStartMs = window.nauticalDuskUtc.getTime()
  const deadlineMs = window.astronomicalDawnUtc.getTime()
  let freeIntervals: Array<{ startMs: number; endMs: number }> = [
    { startMs: Math.max(nowMs, windowStartMs), endMs: deadlineMs },
  ]
  const ordered = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const queueIndex = ordered.findIndex((r) => r.id === targetId)

  for (const req of ordered) {
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
    for (const interval of freeIntervals) {
      const baselineStartMs = Math.max(interval.startMs, createdMs, nowMs, windowStartMs)
      let startMs = baselineStartMs
      let riseAtMs: number | null = null
      if (typeof req.raHours === 'number' && Number.isFinite(req.raHours) && typeof req.decDeg === 'number' && Number.isFinite(req.decDeg)) {
        const riseAt = firstAltitudeAllowedTimeMs(req.raHours, req.decDeg, startMs, interval.endMs)
        if (riseAt == null) {
          failedByAltitudeRise += 1
          continue
        }
        riseAtMs = riseAt
        startMs = riseAt
      }
      const endMs = startMs + durationMs
      if (endMs > interval.endMs || endMs > deadlineMs) {
        failedByIntervalLength += 1
        continue
      }
      const weatherCoveredMs = weatherPermittedCoverageMs(weatherPermittedIntervals, startMs, endMs)
      const weatherCoveragePct = durationMs > 0 ? (weatherCoveredMs / durationMs) * 100 : 0
      if (!weatherCoverageOk(weatherPermittedIntervals, startMs, endMs, 0.8)) {
        failedByWeatherCoverage += 1
        continue
      }
      if (typeof req.raHours === 'number' && Number.isFinite(req.raHours) && typeof req.decDeg === 'number' && Number.isFinite(req.decDeg)) {
        const coveredMs = altitudeAllowedCoverageMs(req.raHours, req.decDeg, startMs, endMs)
        if (coveredMs < durationMs * 0.8) {
          failedByAltitudeCoverage += 1
          continue
        }
      }
      placement = { startMs, endMs }
      placementContext = {
        intervalStartMs: interval.startMs,
        baselineStartMs,
        riseAtMs,
        weatherCoveragePct,
      }
      break
    }

    if (req.id === targetId) {
      if (!placement) {
        const reasons: string[] = []
        if (queueIndex > 0) reasons.push(`Queued behind ${queueIndex} earlier session(s).`)
        if (createdMs >= deadlineMs) reasons.push('Submitted after astronomical-dawn scheduling cutoff.')
        if (failedByAltitudeRise > 0) {
          reasons.push('Target does not rise above 30° in available free intervals.')
        }
        if (failedByAltitudeCoverage > 0) {
          reasons.push('Target altitude coverage is below 80% for required duration in available free intervals.')
        }
        if (failedByIntervalLength > 0) {
          reasons.push('No free interval is long enough to fit session duration before astronomical dawn.')
        }
        if (failedByWeatherCoverage > 0) {
          reasons.push('No interval has weather-permitted coverage >= 80% of session duration.')
        }
        if (reasons.length === 0) reasons.push('No schedulable interval satisfies all constraints.')
        return { status: 'unscheduled', plannedStartIso: null, reasons }
      }

      const reasons: string[] = []
      if (queueIndex > 0) reasons.push(`Queued behind ${queueIndex} earlier session(s).`)
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
    const nextIntervals: Array<{ startMs: number; endMs: number }> = []
    for (const interval of freeIntervals) {
      if (placement.endMs <= interval.startMs || placement.startMs >= interval.endMs) {
        nextIntervals.push(interval)
        continue
      }
      if (placement.startMs > interval.startMs) nextIntervals.push({ startMs: interval.startMs, endMs: placement.startMs })
      if (placement.endMs < interval.endMs) nextIntervals.push({ startMs: placement.endMs, endMs: interval.endMs })
    }
    freeIntervals = nextIntervals.filter((x) => x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs)
  }

  return {
    status: 'unscheduled',
    plannedStartIso: null,
    reasons: ['Could not compute schedule placement for this session.'],
  }
}

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * GET — NINA / observatory poller: pending requests only (default).
 * ?scope=all — full queue (newest first), same auth.
 */
export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get('scope')
  if (scope === 'all') {
    const requests = (await listAll())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublicImagingRequest)
    return withImagingCors({ ok: true as const, scope: 'all' as const, requests })
  }

  const requests = (await listPending()).map(toPublicImagingRequest)
  return withImagingCors({ ok: true as const, scope: 'pending' as const, requests })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400)
  }

  const b = body as Record<string, unknown>
  const parsedFilterPlans = Array.isArray(b.filterPlans)
    ? b.filterPlans
        .map((x) => {
          if (!x || typeof x !== 'object') return null
          const rec = x as Record<string, unknown>
          return {
            filterName: typeof rec.filterName === 'string' ? rec.filterName : '',
            exposureSeconds: rec.exposureSeconds as number | string,
            count: rec.count as number | string,
          }
        })
        .filter((x): x is { filterName: string; exposureSeconds: number | string; count: number | string } => x !== null)
    : undefined
  const firstPlan = parsedFilterPlans && parsedFilterPlans.length > 0 ? parsedFilterPlans[0] : null

  const payload: CreateImagingInput = {
    target: typeof b.target === 'string' ? b.target : b.target == null ? null : String(b.target),
    raHours: b.raHours as CreateImagingInput['raHours'],
    decDeg: b.decDeg as CreateImagingInput['decDeg'],
    filter:
      typeof b.filter === 'string'
        ? b.filter
        : firstPlan
          ? firstPlan.filterName
          : b.filter == null
            ? null
            : String(b.filter),
    exposureSeconds:
      b.exposureSeconds != null
        ? (b.exposureSeconds as CreateImagingInput['exposureSeconds'])
        : firstPlan
          ? firstPlan.exposureSeconds
          : '',
    count:
      b.count != null
        ? (b.count as CreateImagingInput['count'])
        : firstPlan
          ? firstPlan.count
          : '',
    sessionPassword:
      typeof b.sessionPassword === 'string'
        ? b.sessionPassword
        : b.sessionPassword == null
          ? ''
          : String(b.sessionPassword),
    outputMode:
      b.outputMode === 'stacked_master'
        ? 'stacked_master'
        : b.outputMode === 'none'
          ? 'none'
          : 'raw_zip',
    filterPlans: parsedFilterPlans,
    firstName: typeof b.firstName === 'string' ? b.firstName : b.firstName == null ? null : String(b.firstName),
    lastName: typeof b.lastName === 'string' ? b.lastName : b.lastName == null ? null : String(b.lastName),
    email: typeof b.email === 'string' ? b.email : b.email == null ? null : String(b.email),
    sequenceTemplate: b.sessionType === 'variable_star' ? 'variable_star' : 'dso',
  }

  const whenClosedBehavior =
    b.whenClosedBehavior === 'queue_until_ready' ? 'queue_until_ready' : 'reject'
  const obsStatus = await getObservatoryStatus()
  if (!isObservatoryReady(obsStatus) && whenClosedBehavior !== 'queue_until_ready') {
    void appendAuditLog({
      kind: 'queue.rejected',
      message: 'Imaging submit rejected: observatory not ready (closed or busy).',
      detail: { observatoryStatus: obsStatus },
    })
    return withImagingCors(
      {
        ok: false as const,
        error: 'Observatory is closed. Choose queue-until-ready to submit anyway.',
      },
      409
    )
  }

  const result = await createRequest(payload)

  if ('error' in result) {
    void appendAuditLog({
      kind: 'queue.create_failed',
      message: `Imaging submit failed: ${result.error}`,
      detail: { error: result.error },
    })
    return withImagingCors({ ok: false as const, error: result.error }, 400)
  }

  const [pendingNow, precipGate, weatherIntervals] = await Promise.all([
    listPending(),
    detectSunsetSunrisePrecipGate(),
    getTonightWeatherPermittedIntervals(),
  ])
  const insight =
    weatherIntervals.status === 'ok'
      ? computeScheduleInsight(pendingNow, result.id, weatherIntervals.permittedIntervals)
      : {
          status: 'unscheduled' as const,
          plannedStartIso: null,
          reasons: [weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'],
        }
  const unscheduledByWeather =
    weatherIntervals.status !== 'ok' ||
    weatherIntervals.globalHardBlocked === true ||
    insight.reasons.some((r) => r.toLowerCase().includes('weather'))

  await patchRequestScheduleInsight(result.id, insight)

  if (
    insight.status === 'unscheduled' &&
    isObservatoryReady(obsStatus) &&
    whenClosedBehavior !== 'queue_until_ready' &&
    !unscheduledByWeather
  ) {
    await deleteRequestById(result.id)
    const reasonLine = insight.reasons.length > 0 ? insight.reasons.join(' ') : 'No schedulable slot tonight.'
    void appendAuditLog({
      kind: 'queue.rejected',
      message: `Imaging submit rejected: not schedulable tonight while observatory is Ready (${result.id}).`,
      detail: {
        id: result.id,
        target: result.target,
        scheduleStatus: insight.status,
        reasons: insight.reasons,
      },
    })
    return withImagingCors(
      {
        ok: false as const,
        error: `This session does not fit tonight's schedule. ${reasonLine}`,
      },
      409
    )
  }

  void appendAuditLog({
    kind: 'queue.created',
    message: `Imaging session queued: ${result.target} (${result.id}).`,
    detail: {
      id: result.id,
      target: result.target,
      filter: result.filter,
      exposureSeconds: result.exposureSeconds,
      count: result.count,
      estimatedDurationSeconds: result.estimatedDurationSeconds ?? null,
      outputMode: result.outputMode ?? 'raw_zip',
      firstName: result.firstName ?? null,
      lastName: result.lastName ?? null,
      email: result.email ?? null,
    },
  })

  const scheduleMessage =
    insight.status === 'scheduled'
      ? `Scheduling decision for ${result.id}: planned ${insight.plannedStartIso ?? 'unknown'}`
      : `Scheduling decision for ${result.id}: not schedulable tonight`
  void appendAuditLog({
    kind: 'queue.schedule_decision',
    message: scheduleMessage,
    detail: {
      id: result.id,
      target: result.target,
      status: insight.status,
      plannedStartIso: insight.plannedStartIso,
      reasons: insight.reasons,
      weatherPermittedHoursApprox: Math.round(
        weatherIntervals.permittedIntervals.reduce((sum, x) => sum + (x.endMs - x.startMs), 0) / 3600000
      ),
      precipGateSunsetToSunrise:
        precipGate.active == null
          ? 'unknown'
          : precipGate.active
            ? 'active'
            : 'inactive',
      precipGateHitHourCount: precipGate.hitHours.length,
    },
  })

  return withImagingCors({ ok: true as const, request: toPublicImagingRequest(result) }, 201)
}
