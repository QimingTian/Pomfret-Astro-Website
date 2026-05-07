import { NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { imagingCorsHeadersResolved, imagingCorsOptions } from '@/lib/imaging-queue-auth'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { boardUpsertInProgress, listBoardEntries } from '@/lib/imaging-session-board'
import {
  consumeRequestById,
  listPending,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  type ImagingRequest,
} from '@/lib/imaging-queue-store'
import {
  getObservatoryStatus,
  isObservatoryReady,
  touchObservatoryPoll,
} from '@/lib/observatory-status-store'
import { isAltitudeAllowed } from '@/lib/target-altitude'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  isEndNightDue,
  markEndNightDue,
  markEndNightSent,
  wasEndNightSent,
} from '@/lib/end-night-state'
import { getAdminClosedWindowAt } from '@/lib/admin-closed-window-store'
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
      templateKind: r.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso',
      outputMode: r.outputMode,
      targetName: r.target ?? undefined,
      variableStarObservingSeconds:
        r.sequenceTemplate === 'variable_star' &&
        typeof r.estimatedDurationSeconds === 'number' &&
        Number.isFinite(r.estimatedDurationSeconds)
          ? Math.max(0, r.estimatedDurationSeconds - VARIABLE_STAR_SESSION_OVERHEAD_SEC)
          : undefined,
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
 * Returns the next **scheduled** pending session's NINA sequence JSON in `plannedStartIso` order.
 * Schedule feasibility (weather, full-night altitude coverage, dawn window, etc.) is handled by reconcile /
 * `computeScheduleInsight`; this endpoint enforces observatory readiness (for user sessions only), admin
 * closed windows, and current target altitude ≥ 30° before handing JSON to NINA. End-night shutdown JSON
 * bypasses observatory readiness; empty nights are offered at nautical dawn only.
 */
export async function GET() {
  await touchObservatoryPoll()
  const adminWindowNow = await getAdminClosedWindowAt(Date.now())
  if (adminWindowNow) {
    const msg =
      typeof adminWindowNow.description === 'string' && adminWindowNow.description.trim()
        ? adminWindowNow.description.trim()
        : 'Closed by admin schedule control'
    return NextResponse.json({ error: msg }, { status: 409, headers: imagingCorsHeadersResolved() })
  }
  const status = await getObservatoryStatus()
  const pending = await listPending()
  const now = new Date()
  const nowMs = now.getTime()
  const schedulingWindow = getTonightSchedulingWindow(now)
  const nauticalDawnMs = schedulingWindow.nauticalDawnUtc.getTime()
  const deadlineMs = nauticalDawnMs
  const nightStartMs = schedulingWindow.nauticalDuskUtc.getTime()
  const nightKey = nightKeyFromWindowStart(schedulingWindow.nauticalDuskUtc)

  const scheduledTonight = pending
    .filter(
      (r) =>
        r.status === 'scheduled' &&
        r.plannedStartIso != null &&
        Number.isFinite(Date.parse(r.plannedStartIso))
    )
    .sort((a, b) => Date.parse(a.plannedStartIso!) - Date.parse(b.plannedStartIso!))

  let selected: ImagingRequest | null = null
  let blockingError: string | null = null

  for (const candidate of scheduledTonight) {
    const hasRaDec =
      typeof candidate.raHours === 'number' &&
      Number.isFinite(candidate.raHours) &&
      typeof candidate.decDeg === 'number' &&
      Number.isFinite(candidate.decDeg)
    if (hasRaDec) {
      const altitudeCheck = isAltitudeAllowed(candidate.raHours!, candidate.decDeg!)
      if (!altitudeCheck.ok) {
        blockingError = `Target altitude ${altitudeCheck.altitudeDeg.toFixed(2)}° is below ${altitudeCheck.minAltitudeDeg}° (${candidate.target}).`
        continue
      }
    }

    selected = candidate
    break
  }

  if (!selected) {
    if (scheduledTonight.length > 0) {
      return NextResponse.json(
        {
          error:
            blockingError ??
            'No scheduled pending session available for download. Only sessions with status=scheduled and a valid plannedStartIso are delivered, in planned-start order.',
        },
        { status: 409, headers: imagingCorsHeadersResolved() }
      )
    }

    const alreadySent = await wasEndNightSent(nightKey)
    if (!alreadySent) {
      const board = await listBoardEntries()
      const hasTonightActivity = board.some((b) => {
        const createdMs = Date.parse(b.createdAt)
        return Number.isFinite(createdMs) && createdMs >= nightStartMs && createdMs < deadlineMs
      })
      const endNightDue = await isEndNightDue(nightKey)
      const afterSessions = endNightDue || hasTonightActivity
      const emptyNightAtNauticalDawn = !afterSessions && nowMs >= nauticalDawnMs

      if (afterSessions || emptyNightAtNauticalDawn) {
        const queueId = `end-night-${nightKey}`
        const payload = endNightSequenceJson(queueId)
        await markEndNightSent(nightKey)
        void appendAuditLog({
          kind: 'nina.delivered',
          message: `End-night shutdown sequence delivered (${queueId}).`,
          detail: {
            id: queueId,
            type: 'end_night',
            trigger: afterSessions ? 'after_sessions' : 'empty_night_nautical_dawn',
          },
        })
        return new NextResponse(payload, {
          status: 200,
          headers: {
            ...imagingCorsHeadersResolved(),
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      }
    }

    return NextResponse.json(
      {
        error:
          blockingError ??
          'No scheduled pending session available for download. Only sessions with status=scheduled and a valid plannedStartIso are delivered, in planned-start order.',
      },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  if (!isObservatoryReady(status)) {
    return NextResponse.json(
      { error: 'Observatory is closed' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const consumed = await consumeRequestById(selected.id)
  if (!consumed) {
    return NextResponse.json(
      {
        error:
          'No scheduled pending session available for download (queue may have changed). Only status=scheduled rows are consumed.',
      },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const stillScheduled = (await listPending()).filter(
    (r) =>
      r.status === 'scheduled' &&
      r.plannedStartIso != null &&
      Number.isFinite(Date.parse(r.plannedStartIso))
  )
  if (stillScheduled.length === 0) {
    await markEndNightDue(nightKey)
  }

  const sequenceJson = sequenceJsonFor(consumed)
  if (!sequenceJson) {
    return NextResponse.json(
      { error: 'NINA sequence not available for latest session' },
      { status: 404, headers: imagingCorsHeadersResolved() }
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
    message: `NINA sequence delivered (scheduled queue, planned-start order) and removed from queue: ${consumed.target} (${consumed.id}).`,
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
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
