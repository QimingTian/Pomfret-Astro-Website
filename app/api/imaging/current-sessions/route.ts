import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { boardPurgeCompletedOlderThan, listBoardEntries } from '@/lib/imaging-session-board'
import {
  listAll,
  listPending,
  patchRequestScheduleInsight,
  toPublicImagingRequest,
  type CreateImagingInput,
  type ImagingRequest,
} from '@/lib/imaging-queue-store'
import { deleteR2ObjectForQueueId, hasR2ObjectForQueueId } from '@/lib/r2-session-download'
import { hasPreviewImage, removePreviewImage } from '@/lib/imaging-preview-store'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  altitudeAllowedCoverageMs,
  firstAltitudeAllowedTimeMs,
} from '@/lib/target-altitude'
import {
  getTonightWeatherPermittedIntervals,
  weatherCoverageOk,
  type TimeInterval,
} from '@/lib/tonight-weather-gate'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

function estimateDurationSeconds(
  req: Pick<ImagingRequest, 'exposureSeconds' | 'count' | 'filterPlans' | 'estimatedDurationSeconds'>
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

async function reconcilePendingScheduleStatus(): Promise<void> {
  const pending = await listPending()
  if (pending.length === 0) return

  const weatherIntervals = await getTonightWeatherPermittedIntervals()
  const now = Date.now()
  const { nauticalDuskUtc, astronomicalDawnUtc } = getTonightSchedulingWindow(new Date(now))
  const windowStartMs = nauticalDuskUtc.getTime()
  const deadlineMs = astronomicalDawnUtc.getTime()

  const nextById = new Map<string, { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }>()

  if (weatherIntervals.status !== 'ok') {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'],
      })
    }
  } else if (weatherIntervals.globalHardBlocked === true) {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'],
      })
    }
  } else {
    type Interval = { startMs: number; endMs: number }
    let freeIntervals: Interval[] = [{ startMs: Math.max(now, windowStartMs), endMs: deadlineMs }]
    const ordered = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (let i = 0; i < ordered.length; i += 1) {
      const r = ordered[i]!
      const durationMs = estimateDurationSeconds(r) * 1000
      const createdMs = Number.isFinite(Date.parse(r.createdAt)) ? Date.parse(r.createdAt) : now
      let placed: { startMs: number; endMs: number } | null = null

      for (const interval of freeIntervals) {
        let startMs = Math.max(interval.startMs, createdMs, now, windowStartMs)
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
        if (!weatherCoverageOk(weatherIntervals.permittedIntervals as TimeInterval[], startMs, endMs, 0.8)) continue
        if (
          typeof r.raHours === 'number' &&
          Number.isFinite(r.raHours) &&
          typeof r.decDeg === 'number' &&
          Number.isFinite(r.decDeg)
        ) {
          const altCoveredMs = altitudeAllowedCoverageMs(r.raHours, r.decDeg, startMs, endMs)
          if (altCoveredMs < durationMs * 0.8) continue
        }
        placed = { startMs, endMs }
        break
      }

      if (!placed) {
        nextById.set(r.id, {
          status: 'unscheduled',
          plannedStartIso: null,
          reasons: ['No schedulable interval satisfies queue, weather, altitude, and night-window constraints.'],
        })
        continue
      }

      nextById.set(r.id, {
        status: 'scheduled',
        plannedStartIso: new Date(placed.startMs).toISOString(),
        reasons: i > 0 ? [`Queued behind ${i} earlier session(s).`] : ['Scheduled at earliest available slot.'],
      })

      const nextIntervals: Interval[] = []
      for (const interval of freeIntervals) {
        if (placed.endMs <= interval.startMs || placed.startMs >= interval.endMs) {
          nextIntervals.push(interval)
          continue
        }
        if (placed.startMs > interval.startMs) nextIntervals.push({ startMs: interval.startMs, endMs: placed.startMs })
        if (placed.endMs < interval.endMs) nextIntervals.push({ startMs: placed.endMs, endMs: interval.endMs })
      }
      freeIntervals = nextIntervals.filter((x) => x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs)
    }
  }

  for (const r of pending) {
    const next = nextById.get(r.id)
    if (!next) continue
    const prevStatus = r.scheduleStatus
    const prevPlanned = r.plannedStartIso ?? null
    if (prevStatus === next.status && prevPlanned === next.plannedStartIso) continue
    await patchRequestScheduleInsight(r.id, next)
    if (prevStatus === 'scheduled' && next.status === 'unscheduled') {
      void appendAuditLog({
        kind: 'queue.schedule_decision',
        message: `Session ${r.id} moved from scheduled back to pending schedule state.`,
        detail: {
          id: r.id,
          target: r.target,
          previousStatus: prevStatus,
          nextStatus: next.status,
          previousPlannedStartIso: prevPlanned,
          reason: next.reasons[0] ?? 'No reason provided',
        },
      })
    }
  }
}

/**
 * Queue rows (e.g. pending) + board rows (in_progress / completed after NINA download).
 * NINA still uses GET /api/imaging/queue (pending) and GET /api/imaging/nina-sequence (consume).
 */
export async function GET() {
  await reconcilePendingScheduleStatus()

  // Remove completed sessions from the board after 48h, then delete assets.
  const purgedQueueIds = await boardPurgeCompletedOlderThan(48 * 60 * 60 * 1000)
  for (const queueId of purgedQueueIds) {
    await deleteR2ObjectForQueueId(queueId)
    await removePreviewImage(queueId)
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Session ${queueId} deleted by 48h retention trigger (current-sessions refresh).`,
      detail: { id: queueId, source: 'retention_48h_current_sessions' },
    })
  }

  const queue = await listAll()
  const board = await listBoardEntries()

  type Row = {
    id: string
    target: string
    createdAt: string
    updatedAt: string
    status: string
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    raHours?: number | null
    decDeg?: number | null
    filter?: string | null
    exposureSeconds?: number
    count?: number
    outputMode?: 'raw_zip' | 'stacked_master' | 'none'
    estimatedDurationSeconds?: number
    filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
    scheduleStatus?: 'scheduled' | 'unscheduled'
    plannedStartIso?: string | null
    scheduleReasons?: string[]
    hasDownload?: boolean
    downloadPath?: string
    hasPreview?: boolean
    previewPath?: string
    sessionType?: 'dso' | 'variable_star'
  }

  const sessions: Row[] = []
  const queueIds = new Set<string>()

  for (const r of queue) {
    const p = toPublicImagingRequest(r)
    queueIds.add(p.id)
    sessions.push({
      id: p.id,
      target: p.target,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      status: p.status,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      email: p.email ?? null,
      raHours: p.raHours,
      decDeg: p.decDeg,
      filter: p.filter ?? null,
      exposureSeconds: p.exposureSeconds,
      count: p.count,
      outputMode: p.outputMode,
      estimatedDurationSeconds:
        typeof p.estimatedDurationSeconds === 'number' && Number.isFinite(p.estimatedDurationSeconds)
          ? p.estimatedDurationSeconds
          : undefined,
      filterPlans: Array.isArray(p.filterPlans) ? p.filterPlans : undefined,
      scheduleStatus: p.scheduleStatus,
      plannedStartIso: p.plannedStartIso ?? null,
      scheduleReasons: Array.isArray(p.scheduleReasons) ? p.scheduleReasons : undefined,
      sessionType: p.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso',
    })
  }

  for (const b of board) {
    if (!queueIds.has(b.id)) {
      sessions.push({
        id: b.id,
        target: b.target,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        status: b.status,
        firstName: b.firstName ?? null,
        lastName: b.lastName ?? null,
        email: b.email ?? null,
        raHours: b.raHours ?? null,
        decDeg: b.decDeg ?? null,
        filter: b.filter ?? null,
        exposureSeconds: b.exposureSeconds,
        count: b.count,
        outputMode: b.outputMode,
        estimatedDurationSeconds:
          typeof b.estimatedDurationSeconds === 'number' && Number.isFinite(b.estimatedDurationSeconds)
            ? b.estimatedDurationSeconds
            : undefined,
        filterPlans: Array.isArray(b.filterPlans) ? b.filterPlans : undefined,
      })
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const hasDownload = await hasR2ObjectForQueueId(s.id)
      const hasPreview = await hasPreviewImage(s.id)
      return {
        ...s,
        ...(hasDownload ? { hasDownload: true, downloadPath: `/api/imaging/download?queueId=${encodeURIComponent(s.id)}` } : {}),
        ...(hasPreview ? { hasPreview: true, previewPath: `/api/imaging/preview?queueId=${encodeURIComponent(s.id)}` } : {}),
      }
    })
  )

  return withImagingCors({ ok: true as const, sessions: enriched })
}
