import { NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionStartedEmail } from '@/lib/imaging-completion-email'
import { imagingCorsHeadersResolved, imagingCorsOptions } from '@/lib/imaging-queue-auth'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import {
  getActiveOnBoardProject,
  getDeliverableNight,
  getProjectAwaitingSubSessionDelivery,
  getProjectById,
  listProjects,
  markNightInProgress,
  markProjectOnBoard,
  patchProject,
  remainingFramesTotal,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { failInProgressBoardSessions } from '@/lib/imaging-session-failure'
import { boardUpsertInProgress, getBoardEntry, listBoardEntries } from '@/lib/imaging-session-board'
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
import {
  hasRemainingTonightImagingWork,
  nightKeyFromDusk,
} from '@/lib/imaging-tonight-complete'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { logEndNightDelivered, logEndNightDue } from '@/lib/imaging-end-night-audit'
import {
  isEndNightDue,
  markEndNightAfterSessionsSent,
  markEndNightDawnSent,
  wasEndNightAfterSessionsSent,
  wasEndNightDawnSent,
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

/** When the on-board project target is too low, try the next in-progress project whose target is up. */
async function deliverNextEligibleInProgressProjectNight(
  status: Awaited<ReturnType<typeof getObservatoryStatus>>,
  skipProjectId: string
): Promise<NextResponse | null> {
  const projects = (await listProjects())
    .filter((p) => p.status === 'in_progress' && p.id !== skipProjectId && remainingFramesTotal(p) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const project of projects) {
    const night = getDeliverableNight(project)
    if (!night?.ninaSequenceJson) continue
    const altCheck = isAltitudeAllowed(project.raHours, project.decDeg)
    if (!altCheck.ok) continue
    if (!isObservatoryReady(status)) {
      return NextResponse.json(
        { error: 'Observatory is closed' },
        { status: 409, headers: imagingCorsHeadersResolved() }
      )
    }
    const onBoard = await getActiveOnBoardProject()
    if (onBoard && onBoard.id !== project.id) {
      const nights = onBoard.nights.map((n) =>
        n.status === 'in_progress' ? { ...n, status: 'scheduled' as const } : n
      )
      await patchProject(onBoard.id, { onBoard: false, nights })
    }
    await markProjectOnBoard(project.id)
    return deliverProjectNightJson(
      project,
      night,
      `NINA project night delivered: ${project.target} night ${night.nightIndex} (${night.id}).`
    )
  }
  return null
}

async function deliverProjectNightJson(
  project: ImagingProject,
  night: ProjectNight,
  auditMessage: string
): Promise<NextResponse> {
  if (!project.onBoard) {
    await markProjectOnBoard(project.id)
  }
  await markNightInProgress(project.id, night.id)
  const board = await getBoardEntry(project.id)
  if (!board) {
    await boardUpsertInProgress({
      id: project.id,
      target: project.target,
      createdAt: project.createdAt,
      firstName: project.firstName ?? null,
      lastName: project.lastName ?? null,
      email: project.email ?? null,
      raHours: project.raHours,
      decDeg: project.decDeg,
      filter: project.filterPlansTotal[0]?.filterName ?? null,
      exposureSeconds: project.filterPlansTotal[0]?.exposureSeconds,
      count: night.filterPlansTonight[0]?.count ?? 0,
      outputMode: project.outputMode,
      filterPlans: project.filterPlansTotal,
      estimatedDurationSeconds: project.estimatedDurationSeconds,
      sessionPasswordHash: project.sessionPasswordHash,
      userId: project.userId,
      projectMode: true,
    })
  }
  void appendAuditLog({
    kind: 'nina.delivered',
    message: auditMessage,
    detail: { projectId: project.id, nightId: night.id, nightIndex: night.nightIndex },
  })
  return new NextResponse(night.ninaSequenceJson!, {
    status: 200,
    headers: {
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
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
  const nightKey = nightKeyFromDusk(schedulingWindow.nauticalDuskUtc)

  const activeOnBoard = await getActiveOnBoardProject()
  const projectForSubDelivery = await getProjectAwaitingSubSessionDelivery()

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
    if (activeOnBoard) {
      const projectAlt = isAltitudeAllowed(activeOnBoard.raHours, activeOnBoard.decDeg)
      if (projectAlt.ok) {
        if (!candidate.projectMode) {
          blockingError = `Multi-night project target is above 30° (${activeOnBoard.target}); other sessions run when it is below 30°.`
          continue
        }
        if (candidate.projectMode && candidate.id !== activeOnBoard.id) {
          blockingError = `Multi-night project "${activeOnBoard.target}" is above 30°; the next project runs when it is below 30°.`
          continue
        }
      }
    }
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
    const remainingTonight = await hasRemainingTonightImagingWork(
      nightKey,
      nightStartMs,
      deadlineMs,
      activeOnBoard ?? projectForSubDelivery
    )

    // Night 2+ delivers via project sub-session ids after the queue row was consumed on night 1.
    // Try that before blocking behind other scheduled queue rows (which only apply below 30°).
    if (remainingTonight && projectForSubDelivery) {
      const night = getDeliverableNight(projectForSubDelivery)
      if (night?.ninaSequenceJson) {
        if (!isObservatoryReady(status)) {
          return NextResponse.json(
            { error: 'Observatory is closed' },
            { status: 409, headers: imagingCorsHeadersResolved() }
          )
        }
        const altCheck = isAltitudeAllowed(
          projectForSubDelivery.raHours,
          projectForSubDelivery.decDeg
        )
        if (!altCheck.ok) {
          const successor = await deliverNextEligibleInProgressProjectNight(
            status,
            projectForSubDelivery.id
          )
          if (successor) return successor
        } else {
          return deliverProjectNightJson(
            projectForSubDelivery,
            night,
            `NINA project night delivered: ${projectForSubDelivery.target} night ${night.nightIndex} (${night.id}).`
          )
        }
      }
    }

    if (scheduledTonight.length > 0 && remainingTonight) {
      return NextResponse.json(
        {
          error:
            blockingError ??
            'No scheduled pending session available for download. Only sessions with status=scheduled and a valid plannedStartIso are delivered, in planned-start order.',
        },
        { status: 409, headers: imagingCorsHeadersResolved() }
      )
    }

    if (remainingTonight) {
      return NextResponse.json(
        {
          error:
            'Imaging still scheduled for tonight; end night runs after the last session completes.',
        },
        { status: 409, headers: imagingCorsHeadersResolved() }
      )
    }

    const board = await listBoardEntries()
    const hasTonightActivity = board.some((b) => {
      const markers = [b.downloadedAt, b.updatedAt, b.completedAt, b.createdAt].filter(
        (m): m is string => typeof m === 'string' && m.length > 0
      )
      return markers.some((m) => {
        const ms = Date.parse(m)
        return Number.isFinite(ms) && ms >= nightStartMs && ms < deadlineMs
      })
    })
    const endNightDue = await isEndNightDue(nightKey)
    const afterSessionsEligible = endNightDue || hasTonightActivity

    if (afterSessionsEligible && !(await wasEndNightAfterSessionsSent(nightKey))) {
      const queueId = `end-night-${nightKey}`
      const payload = endNightSequenceJson(queueId)
      await markEndNightAfterSessionsSent(nightKey)
      void logEndNightDelivered({ nightKey, queueId, trigger: 'after_sessions' })
      return new NextResponse(payload, {
        status: 200,
        headers: {
          ...imagingCorsHeadersResolved(),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    if (nowMs >= nauticalDawnMs && !(await wasEndNightDawnSent(nightKey))) {
      const queueId = `end-night-${nightKey}-dawn`
      const payload = endNightSequenceJson(queueId)
      await markEndNightDawnSent(nightKey)
      void logEndNightDelivered({ nightKey, queueId, trigger: 'nautical_dawn' })
      return new NextResponse(payload, {
        status: 200,
        headers: {
          ...imagingCorsHeadersResolved(),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
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

  const exceptBoardId = selected.projectMode ? selected.id : undefined
  await failInProgressBoardSessions(exceptBoardId, 'interrupted_before_new_nina_delivery')

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
    void logEndNightDue(nightKey, 'last scheduled queue row consumed')
  }

  let sequenceJson: string | null = null
  let progressQueueId = consumed.id

  if (consumed.projectMode) {
    const project = await getProjectById(consumed.id)
    const night = project ? getDeliverableNight(project) : undefined
    if (!night?.ninaSequenceJson) {
      return NextResponse.json(
        { error: 'Project night sequence not available for download' },
        { status: 404, headers: imagingCorsHeadersResolved() }
      )
    }
    sequenceJson = night.ninaSequenceJson
    progressQueueId = night.id
    await markProjectOnBoard(consumed.id)
    await markNightInProgress(consumed.id, night.id)
  } else {
    sequenceJson = sequenceJsonFor(consumed)
  }

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
    userId: consumed.userId,
    ...(consumed.projectMode ? { projectMode: true as const } : {}),
  })

  const startedAtIso = new Date().toISOString()
  void sendSessionStartedEmail({
    queueId: progressQueueId,
    target: consumed.target,
    email: consumed.email,
    firstName: consumed.firstName,
    startedAtIso,
  }).then((result) => {
    if (!result.sent) {
      return appendAuditLog({
        kind: 'session.progress',
        message: `Start email skipped/failed for ${consumed.id}: ${result.reason ?? 'unknown reason'}`,
        detail: { queueId: progressQueueId, reason: result.reason ?? null },
      })
    }
    return appendAuditLog({
      kind: 'session.progress',
      message: `Start email sent for ${progressQueueId}.`,
      detail: { queueId: progressQueueId, email: consumed.email ?? null },
    })
  })

  void appendAuditLog({
    kind: 'nina.delivered',
    message: consumed.projectMode
      ? `NINA project first night delivered: ${consumed.target} (${progressQueueId}).`
      : `NINA sequence delivered (scheduled queue, planned-start order) and removed from queue: ${consumed.target} (${consumed.id}).`,
    detail: {
      id: consumed.id,
      nightId: consumed.projectMode ? progressQueueId : undefined,
      target: consumed.target,
      exposureSeconds: consumed.exposureSeconds,
      count: consumed.count,
      projectMode: consumed.projectMode ?? false,
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
