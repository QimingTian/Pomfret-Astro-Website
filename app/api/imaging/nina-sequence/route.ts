import { NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { imagingCorsHeaders, imagingCorsOptions } from '@/lib/imaging-queue-auth'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { boardUpsertInProgress, listBoardEntries } from '@/lib/imaging-session-board'
import { consumeRequestById, listPending, type ImagingRequest } from '@/lib/imaging-queue-store'
import {
  getObservatoryStatus,
  isObservatoryReady,
  touchObservatoryPoll,
} from '@/lib/observatory-status-store'
import {
  altitudeAllowedCoverageMs,
  firstAltitudeAllowedTimeMs,
  isAltitudeAllowed,
} from '@/lib/target-altitude'
import { canFinishBeforeSunriseBuffer, getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { markEndNightSent, wasEndNightSent } from '@/lib/end-night-state'
import { getAdminClosedWindowAt, getAdminClosedWindowsInRange } from '@/lib/admin-closed-window-store'
import {
  getTonightWeatherPermittedIntervals,
  weatherCoverageOk,
  type TimeInterval,
} from '@/lib/tonight-weather-gate'
import endNightTemplate from '@/End Night Session.json'

export const runtime = 'nodejs'
const END_NIGHT_TEMPLATE = endNightTemplate as Record<string, unknown>

export function OPTIONS() {
  return imagingCorsOptions()
}

function sequenceJsonFor(r: ImagingRequest): string | null {
  if (r.ninaSequenceJson) return r.ninaSequenceJson
  if (r.raHours != null && r.decDeg != null && r.filter) {
    return buildNinaSequenceJson({
      raHoursDecimal: r.raHours,
      decDegDecimal: r.decDeg,
      filterName: r.filter,
      exposureSeconds: r.exposureSeconds,
      exposureCount: r.count,
      pomfretQueueId: r.id,
    })
  }
  return null
}

function nightKeyFromWindowStart(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function endNightSequenceJson(queueId: string): string {
  const root = structuredClone(END_NIGHT_TEMPLATE) as Record<string, unknown>
  root['PomfretAstro'] = {
    QueueId: queueId,
    SessionType: 'end_night',
    SessionProgressHint:
      'POST JSON to /api/imaging/session-progress with { "queueId": "<QueueId>", ... }',
  }
  return JSON.stringify(root, null, 2)
}

/**
 * Fixed URL for observatory computer.
 * Returns the next scheduled session's NINA sequence JSON and removes it from the API queue;
 * the session is kept on the Remote "Current sessions" board as in_progress until NINA posts completion.
 */
export async function GET() {
  await touchObservatoryPoll()
  const weatherIntervals = await getTonightWeatherPermittedIntervals()
  if (weatherIntervals.status !== 'ok') {
    return NextResponse.json(
      { error: weatherIntervals.reason ?? 'Unable to evaluate tonight weather' },
      { status: 409, headers: imagingCorsHeaders }
    )
  }
  if (weatherIntervals.globalHardBlocked === true) {
    return NextResponse.json(
      { error: weatherIntervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.' },
      { status: 409, headers: imagingCorsHeaders }
    )
  }
  const adminWindowNow = await getAdminClosedWindowAt(Date.now())
  if (adminWindowNow) {
    const msg =
      typeof adminWindowNow.description === 'string' && adminWindowNow.description.trim()
        ? adminWindowNow.description.trim()
        : 'Closed by admin schedule control'
    return NextResponse.json({ error: msg }, { status: 409, headers: imagingCorsHeaders })
  }
  const status = await getObservatoryStatus()
  const pending = await listPending()
  const now = new Date()
  const schedulingWindow = getTonightSchedulingWindow(now)
  const deadlineMs = schedulingWindow.astronomicalDawnUtc.getTime()
  const scheduleFloorMs = Math.max(now.getTime(), schedulingWindow.nauticalDuskUtc.getTime())
  const nightKey = nightKeyFromWindowStart(schedulingWindow.nauticalDuskUtc)
  const imagingPending = pending

  if (!isObservatoryReady(status) && imagingPending.length > 0) {
    return NextResponse.json(
      { error: 'Observatory is closed' },
      { status: 409, headers: imagingCorsHeaders }
    )
  }

  const estimateSeconds = (r: ImagingRequest): number => {
    if (typeof r.estimatedDurationSeconds === 'number' && Number.isFinite(r.estimatedDurationSeconds)) {
      return Math.max(r.estimatedDurationSeconds, 60)
    }
    const fromPlans =
      Array.isArray(r.filterPlans) && r.filterPlans.length > 0
        ? r.filterPlans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0) + 15 * 60
        : r.exposureSeconds * r.count + 15 * 60
    return Math.max(fromPlans, 60)
  }
  const weatherCoverageFor = (
    permittedIntervals: TimeInterval[],
    startMs: number,
    durationMs: number
  ): boolean => weatherCoverageOk(permittedIntervals, startMs, startMs + durationMs, 0.8)
  const altitudeCoverageOk = (r: ImagingRequest, startMs: number, durationMs: number): boolean => {
    const raHours = r.raHours
    const decDeg = r.decDeg
    if (typeof raHours !== 'number' || !Number.isFinite(raHours)) return true
    if (typeof decDeg !== 'number' || !Number.isFinite(decDeg)) return true
    const endMs = startMs + durationMs
    const coveredMs = altitudeAllowedCoverageMs(raHours, decDeg, startMs, endMs)
    return coveredMs >= durationMs * 0.8
  }

  type Interval = { startMs: number; endMs: number }
  let freeIntervals: Interval[] = [{ startMs: scheduleFloorMs, endMs: deadlineMs }]
  const adminClosedIntervals = await getAdminClosedWindowsInRange(scheduleFloorMs, deadlineMs)
  if (adminClosedIntervals.length > 0) {
    const next: Interval[] = []
    for (const interval of freeIntervals) {
      let chunks: Interval[] = [interval]
      for (const c of adminClosedIntervals) {
        const sliced: Interval[] = []
        for (const chunk of chunks) {
          if (c.endMs <= chunk.startMs || c.startMs >= chunk.endMs) {
            sliced.push(chunk)
            continue
          }
          if (c.startMs > chunk.startMs) sliced.push({ startMs: chunk.startMs, endMs: c.startMs })
          if (c.endMs < chunk.endMs) sliced.push({ startMs: c.endMs, endMs: chunk.endMs })
        }
        chunks = sliced
      }
      next.push(...chunks)
    }
    freeIntervals = next.filter((x) => x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs)
  }
  const scheduled: Array<{ req: ImagingRequest; startMs: number }> = []
  const unscheduled: ImagingRequest[] = []

  for (const r of imagingPending) {
    const durationMs = estimateSeconds(r) * 1000
    const createdMs = Number.isFinite(Date.parse(r.createdAt)) ? Date.parse(r.createdAt) : scheduleFloorMs
    let placed: { startMs: number; endMs: number } | null = null

    for (const interval of freeIntervals) {
      let startMs = Math.max(interval.startMs, createdMs, scheduleFloorMs)
      if (
        typeof r.raHours === 'number' &&
        Number.isFinite(r.raHours) &&
        typeof r.decDeg === 'number' &&
        Number.isFinite(r.decDeg)
      ) {
        const riseAt = firstAltitudeAllowedTimeMs(r.raHours, r.decDeg, startMs, interval.endMs)
        if (riseAt == null) continue
        startMs = riseAt
      }
      const endMs = startMs + durationMs
      if (endMs > interval.endMs || endMs > deadlineMs) continue
      if (!weatherCoverageFor(weatherIntervals.permittedIntervals, startMs, durationMs)) continue
      if (!altitudeCoverageOk(r, startMs, durationMs)) continue
      placed = { startMs, endMs }
      break
    }

    if (!placed) {
      unscheduled.push(r)
      continue
    }

    scheduled.push({ req: r, startMs: placed.startMs })
    const nextFree: Interval[] = []
    for (const interval of freeIntervals) {
      if (placed.endMs <= interval.startMs || placed.startMs >= interval.endMs) {
        nextFree.push(interval)
        continue
      }
      if (placed.startMs > interval.startMs) {
        nextFree.push({ startMs: interval.startMs, endMs: placed.startMs })
      }
      if (placed.endMs < interval.endMs) {
        nextFree.push({ startMs: placed.endMs, endMs: interval.endMs })
      }
    }
    freeIntervals = nextFree.filter((x) => x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs)
  }

  const candidateOrder = [...scheduled.sort((a, b) => a.startMs - b.startMs).map((x) => x.req), ...unscheduled]

  let selected: ImagingRequest | null = null
  let blockingError: string | null = null
  for (const candidate of candidateOrder) {
    const raHours = candidate.raHours ?? 0
    const decDeg = candidate.decDeg ?? 0
    const altitudeCheck = isAltitudeAllowed(raHours, decDeg)
    if (!altitudeCheck.ok) {
      blockingError = `Target altitude ${altitudeCheck.altitudeDeg.toFixed(2)}° is below ${altitudeCheck.minAltitudeDeg}°`
      continue
    }

    const finishWindow = canFinishBeforeSunriseBuffer(candidate.exposureSeconds, candidate.count)
    if (!finishWindow.ok) {
      blockingError =
        `Insufficient time before sunrise buffer: need ${finishWindow.requiredSeconds.toFixed(0)}s, ` +
        `available ${Math.max(0, finishWindow.secondsUntilDeadline).toFixed(0)}s before ` +
        `${finishWindow.deadlineUtc.toISOString()} (1h before sunrise).`
      continue
    }
    if (!altitudeCoverageOk(candidate, now.getTime(), estimateSeconds(candidate) * 1000)) {
      blockingError =
        'Target altitude coverage is below 80% for this session duration at the current start time.'
      continue
    }
    if (!weatherCoverageFor(weatherIntervals.permittedIntervals, now.getTime(), estimateSeconds(candidate) * 1000)) {
      blockingError =
        'Weather-permitted coverage is below 80% for this session duration at the current start time.'
      continue
    }
    selected = candidate
    break
  }

  if (!selected) {
    const alreadySent = await wasEndNightSent(nightKey)
    if (!alreadySent) {
      const board = await listBoardEntries()
      const hasTonightActivity = board.some((b) => {
        const createdMs = Date.parse(b.createdAt)
        return Number.isFinite(createdMs) && createdMs >= scheduleFloorMs && createdMs < deadlineMs
      })
      if (hasTonightActivity) {
        const queueId = `end-night-${nightKey}`
        const payload = endNightSequenceJson(queueId)
        await markEndNightSent(nightKey)
        void appendAuditLog({
          kind: 'nina.delivered',
          message: `End-night shutdown sequence delivered (${queueId}).`,
          detail: { id: queueId, type: 'end_night' },
        })
        return new NextResponse(payload, {
          status: 200,
          headers: {
            ...imagingCorsHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      }
    }

    return NextResponse.json(
      { error: blockingError ?? 'No pending session available for download' },
      { status: 409, headers: imagingCorsHeaders }
    )
  }

  const consumed = await consumeRequestById(selected.id)
  if (!consumed) {
    return NextResponse.json({ error: 'No pending session available for download' }, { status: 409, headers: imagingCorsHeaders })
  }

  const sequenceJson = sequenceJsonFor(consumed)
  if (!sequenceJson) {
    return NextResponse.json(
      { error: 'NINA sequence not available for latest session' },
      { status: 404, headers: imagingCorsHeaders }
    )
  }

  await boardUpsertInProgress({
    id: consumed.id,
    target: consumed.target,
    createdAt: consumed.createdAt,
    firstName: consumed.firstName ?? null,
    lastName: consumed.lastName ?? null,
    email: consumed.email ?? null,
    raHours: consumed.raHours ?? null,
    decDeg: consumed.decDeg ?? null,
    filter: consumed.filter ?? null,
    exposureSeconds: consumed.exposureSeconds,
    count: consumed.count,
    outputMode: consumed.outputMode,
    filterPlans: consumed.filterPlans,
    estimatedDurationSeconds: consumed.estimatedDurationSeconds,
    sessionPasswordHash: consumed.sessionPasswordHash,
  })

  void appendAuditLog({
    kind: 'nina.delivered',
    message: `NINA sequence delivered by schedule order and removed from queue: ${consumed.target} (${consumed.id}).`,
    detail: {
      id: consumed.id,
      target: consumed.target,
      exposureSeconds: consumed.exposureSeconds,
      count: consumed.count,
    },
  })

  return new NextResponse(sequenceJson, {
    status: 200,
    headers: {
      ...imagingCorsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
