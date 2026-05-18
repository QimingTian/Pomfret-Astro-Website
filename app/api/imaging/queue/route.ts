import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  imagingCorsOptions,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import {
  createRequest,
  deleteRequestById,
  getRequestById,
  listAll,
  listPending,
  patchRequestScheduleInsight,
  toPublicImagingRequest,
  type CreateImagingInput,
} from '@/lib/imaging-queue-store'
import {
  collectTonightProjectSubSessionOccupancy,
  createImagingProject,
  getProjectById,
  listProjects,
} from '@/lib/imaging-project-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { planAndScheduleProjectTonight } from '@/lib/imaging-project-planner'
import { getScheduleReservedIntervalsForActiveProject } from '@/lib/imaging-project-altitude-hold'
import { computeScheduleInsight } from '@/lib/imaging-queue-schedule-insight'
import { getObservatoryStatus, isObservatoryReady } from '@/lib/observatory-status-store'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { getTonightWeatherPermittedIntervals } from '@/lib/tonight-weather-gate'

export const runtime = 'nodejs'

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
    estimatedDurationSeconds:
      typeof b.estimatedDurationSeconds === 'number' && Number.isFinite(b.estimatedDurationSeconds)
        ? b.estimatedDurationSeconds
        : undefined,
    projectMode: b.projectMode === true,
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

  if (result.projectMode && result.raHours != null && result.decDeg != null && result.sessionPasswordHash) {
    await createImagingProject({
      id: result.id,
      target: result.target,
      raHours: result.raHours,
      decDeg: result.decDeg,
      outputMode: result.outputMode ?? 'raw_zip',
      filterPlans: result.filterPlans ?? [],
      estimatedDurationSeconds: result.estimatedDurationSeconds ?? 0,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      sessionPasswordHash: result.sessionPasswordHash,
    })
  }

  const [pendingNow, precipGate, weatherIntervals] = await Promise.all([
    listPending(),
    detectSunsetSunrisePrecipGate(),
    getTonightWeatherPermittedIntervals(),
  ])

  let insight:
    | { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }
    | undefined

  if (weatherIntervals.status === 'ok' && result.projectMode) {
    const project = await getProjectById(result.id)
    if (project) {
      const now = new Date()
      const window = getTonightSchedulingWindow(now)
      const nowMs = now.getTime()
      const freeIntervals = [
        {
          startMs: Math.max(nowMs, window.nauticalDuskUtc.getTime()),
          endMs: window.nauticalDawnUtc.getTime(),
        },
      ]
      insight = await planAndScheduleProjectTonight(
        project.id,
        freeIntervals,
        weatherIntervals.permittedIntervals,
        now
      )
    }
  }

  if (!insight) {
    const now = new Date()
    const window = getTonightSchedulingWindow(now)
    const reservedIntervals =
      weatherIntervals.status === 'ok'
        ? await getScheduleReservedIntervalsForActiveProject(now)
        : []
    const strip = getTonightScheduleStrip(now)
    const projectSubSessions =
      weatherIntervals.status === 'ok'
        ? collectTonightProjectSubSessionOccupancy(
            await listProjects(),
            strip.nightKey,
            window.nauticalDuskUtc.getTime(),
            window.nauticalDawnUtc.getTime()
          )
        : []
    insight =
      weatherIntervals.status === 'ok'
        ? computeScheduleInsight(pendingNow, result.id, weatherIntervals.permittedIntervals, {
            reservedIntervals,
            projectSubSessions,
          })
        : {
            status: 'unscheduled' as const,
            plannedStartIso: null,
            reasons: [weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'],
          }
  }

  const unscheduledByWeather =
    weatherIntervals.status !== 'ok' ||
    weatherIntervals.globalHardBlocked === true ||
    insight.reasons.some((r) => r.toLowerCase().includes('weather'))

  await patchRequestScheduleInsight(result.id, insight)

  if (
    insight.status === 'unscheduled' &&
    !result.projectMode &&
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

  const persisted = await getRequestById(result.id)
  return withImagingCors({ ok: true as const, request: toPublicImagingRequest(persisted ?? result) }, 201)
}
