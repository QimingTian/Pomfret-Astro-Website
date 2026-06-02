import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionStartedEmail } from '@/lib/imaging-completion-email'
import {
  imagingCorsHeadersResolved,
  imagingCorsOptions,
  imagingQueueAuthorized,
  imagingUnauthorized,
} from '@/lib/imaging-queue-auth'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import {
  getActiveOnBoardProject,
  expireMissedScheduledProjectNights,
  getDeliverableNight,
  getNightForNinaDelivery,
  getProjectAwaitingSubSessionDelivery,
  getProjectById,
  getProjectByNightSubId,
  listProjects,
  markNightInProgress,
  markProjectOnBoard,
  patchProject,
  projectHoldsQueueTonight,
  releaseOnBoardProjectIfNothingDeliverable,
  remainingFramesTotal,
  tonightDurationSecondsFromPlans,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { publishProgress } from '@/lib/imaging-progress-live'
import { failInProgressBoardSessions } from '@/lib/imaging-session-failure'
import { boardMarkDownloaded, boardUpsertInProgress, listBoardEntries } from '@/lib/imaging-session-board'
import {
  consumeRequestById,
  listPending,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  type ImagingRequest,
} from '@/lib/imaging-queue-store'
import type { ObservatoryStatus } from '@/lib/observatory-status-store'
import {
  getObservatoryStatus,
  isNinaReportedRunningNow,
  isObservatoryReady,
  touchObservatoryPoll,
} from '@/lib/observatory-status-store'
import { isAltitudeAllowed } from '@/lib/target-altitude'
import { hasRemainingTonightImagingWork } from '@/lib/imaging-tonight-complete'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
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

/** After the queue row is consumed, deliver sub-sessions by sub-session id (same path for every session index). */
function shouldDeliverProjectSubSessionDirect(
  project: ImagingProject,
  pending: ImagingRequest[]
): boolean {
  if (project.onBoard) return true
  return !pending.some((r) => r.id === project.id)
}

/** Try delivering the next schedulable project sub-session for tonight (on-board projects first). */
async function tryDeliverProjectSubSessionTonight(
  status: ObservatoryStatus,
  nightKey: string,
  project: ImagingProject,
  activeOnBoard: ImagingProject | undefined,
  allowRedeliverInProgress: boolean
): Promise<NextResponse | null> {
  const night = getNightForNinaDelivery(project, nightKey, { allowRedeliverInProgress })
  if (!night?.ninaSequenceJson) {
    if (activeOnBoard && activeOnBoard.id === project.id) {
      return deliverNextEligibleInProgressProjectSubSession(
        status,
        activeOnBoard.id,
        nightKey,
        allowRedeliverInProgress
      )
    }
    return null
  }
  if (!isObservatoryReady(status)) {
    return NextResponse.json(
      { error: 'Observatory is closed' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  const altCheck = isAltitudeAllowed(project.raHours, project.decDeg)
  if (!altCheck.ok) {
    if (activeOnBoard?.id === project.id) {
      const successor = await deliverNextEligibleInProgressProjectSubSession(
        status,
        project.id,
        nightKey,
        allowRedeliverInProgress
      )
      if (successor) return successor
    }
    return NextResponse.json(
      {
        error: `Target altitude ${altCheck.altitudeDeg.toFixed(2)}° is below ${altCheck.minAltitudeDeg}° (${project.target}).`,
      },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  const redeliver = night.status === 'in_progress'
  return deliverProjectSubSessionJson(
    project,
    night,
    redeliver
      ? `NINA project sub-session re-delivered: ${project.target} Session ${night.nightIndex} (${night.id}).`
      : `NINA project sub-session delivered: ${project.target} Session ${night.nightIndex} (${night.id}).`,
    { redeliver }
  )
}

/** When the on-board project target is too low, try the next in-progress project whose target is up. */
async function deliverNextEligibleInProgressProjectSubSession(
  status: Awaited<ReturnType<typeof getObservatoryStatus>>,
  skipProjectId: string,
  stripNightKey: string,
  allowRedeliverInProgress: boolean
): Promise<NextResponse | null> {
  const projects = (await listProjects())
    .filter((p) => p.status === 'in_progress' && p.id !== skipProjectId && remainingFramesTotal(p) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const project of projects) {
    const night = getNightForNinaDelivery(project, stripNightKey, { allowRedeliverInProgress })
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
    const redeliver = night.status === 'in_progress'
    return deliverProjectSubSessionJson(
      project,
      night,
      redeliver
        ? `NINA project sub-session re-delivered: ${project.target} Session ${night.nightIndex} (${night.id}).`
        : `NINA project sub-session delivered: ${project.target} Session ${night.nightIndex} (${night.id}).`,
      { redeliver }
    )
  }
  return null
}

async function deliverProjectSubSessionJson(
  project: ImagingProject,
  night: ProjectNight,
  auditMessage: string,
  options?: { redeliver?: boolean }
): Promise<NextResponse> {
  const match = await getProjectByNightSubId(night.id)
  const projectRef = match?.project ?? project
  const nightRef = match?.night ?? night
  const redeliver = options?.redeliver === true
  if (nightRef.status !== 'scheduled') {
    if (!(redeliver && nightRef.status === 'in_progress')) {
      return NextResponse.json(
        { error: 'Project sub-session sequence already delivered; not available for re-download.' },
        { status: 409, headers: imagingCorsHeadersResolved() }
      )
    }
  }

  if (!projectRef.onBoard) {
    await markProjectOnBoard(projectRef.id)
  }
  if (!redeliver) {
    await markNightInProgress(projectRef.id, nightRef.id)

    const startedAtIso = new Date().toISOString()
    await boardUpsertInProgress({
      id: projectRef.id,
      target: projectRef.target,
      createdAt: projectRef.createdAt,
      firstName: projectRef.firstName ?? null,
      lastName: projectRef.lastName ?? null,
      email: projectRef.email ?? null,
      raHours: projectRef.raHours,
      decDeg: projectRef.decDeg,
      filter: nightRef.filterPlansTonight[0]?.filterName ?? projectRef.filterPlansTotal[0]?.filterName ?? null,
      exposureSeconds:
        nightRef.filterPlansTonight[0]?.exposureSeconds ??
        projectRef.filterPlansTotal[0]?.exposureSeconds,
      count: nightRef.filterPlansTonight[0]?.count ?? 0,
      outputMode: projectRef.outputMode,
      filterPlans: projectRef.filterPlansTotal,
      estimatedDurationSeconds: tonightDurationSecondsFromPlans(nightRef.filterPlansTonight),
      sessionPasswordHash: projectRef.sessionPasswordHash,
      userId: projectRef.userId,
      projectMode: true,
    })
    await boardMarkDownloaded(projectRef.id)

    void sendSessionStartedEmail({
      queueId: nightRef.id,
      target: projectRef.target,
      email: projectRef.email,
      firstName: projectRef.firstName,
      startedAtIso,
    }).then((result) => {
      if (!result.sent) {
        return appendAuditLog({
          kind: 'session.progress',
          message: `Start email skipped/failed for ${nightRef.id}: ${result.reason ?? 'unknown reason'}`,
          detail: { queueId: nightRef.id, projectId: projectRef.id, reason: result.reason ?? null },
        })
      }
      return appendAuditLog({
        kind: 'session.progress',
        message: `Start email sent for ${nightRef.id}.`,
        detail: { queueId: nightRef.id, projectId: projectRef.id, email: projectRef.email ?? null },
      })
    })

    publishProgress(nightRef.id, { type: 'status', queueStatus: 'in_progress' })
  } else {
    await boardMarkDownloaded(projectRef.id)
  }

  void appendAuditLog({
    kind: redeliver ? 'nina.redelivered' : 'nina.delivered',
    message: auditMessage,
    detail: {
      projectId: projectRef.id,
      subSessionId: nightRef.id,
      sessionIndex: nightRef.nightIndex,
      redeliver,
    },
  })

  return new NextResponse(nightRef.ninaSequenceJson!, {
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
export async function GET(request: NextRequest) {
  if (!imagingQueueAuthorized(request)) {
    return imagingUnauthorized()
  }

  await touchObservatoryPoll()
  const now = new Date()
  const nowMs = now.getTime()
  await expireMissedScheduledProjectNights(now)
  const adminWindowNow = await getAdminClosedWindowAt(nowMs)
  if (adminWindowNow) {
    const msg =
      typeof adminWindowNow.description === 'string' && adminWindowNow.description.trim()
        ? adminWindowNow.description.trim()
        : 'Closed by admin schedule control'
    return NextResponse.json({ error: msg }, { status: 409, headers: imagingCorsHeadersResolved() })
  }
  const status = await getObservatoryStatus()
  const allowRedeliverInProgress = !(await isNinaReportedRunningNow(nowMs))
  const pending = await listPending()
  const schedulingWindow = getTonightSchedulingWindow(now)
  const strip = getTonightScheduleStrip(now)
  const nauticalDawnMs = schedulingWindow.nauticalDawnUtc.getTime()
  const deadlineMs = nauticalDawnMs
  const nightStartMs = schedulingWindow.nauticalDuskUtc.getTime()
  /** Match project planner + Remote strip (4pm-local day), not UTC calendar day of nautical dusk. */
  const nightKey = strip.nightKey

  const activeOnBoard = await getActiveOnBoardProject()
  if (activeOnBoard) {
    await releaseOnBoardProjectIfNothingDeliverable(activeOnBoard.id, nightKey)
  }
  const activeOnBoardAfterRelease = await getActiveOnBoardProject()
  const projectForSubDeliveryFresh = await getProjectAwaitingSubSessionDelivery(nightKey)

  const directProject = projectForSubDeliveryFresh ?? activeOnBoardAfterRelease
  if (directProject && shouldDeliverProjectSubSessionDirect(directProject, pending)) {
    const delivered = await tryDeliverProjectSubSessionTonight(
      status,
      nightKey,
      directProject,
      activeOnBoardAfterRelease,
      allowRedeliverInProgress
    )
    if (delivered) return delivered
  }

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
    if (activeOnBoardAfterRelease && projectHoldsQueueTonight(activeOnBoardAfterRelease, nightKey)) {
      const projectAlt = isAltitudeAllowed(
        activeOnBoardAfterRelease.raHours,
        activeOnBoardAfterRelease.decDeg
      )
      if (projectAlt.ok) {
        if (!candidate.projectMode) {
          blockingError = `Multi-night project target is above 30° (${activeOnBoardAfterRelease.target}); other sessions run when it is below 30°.`
          continue
        }
        if (candidate.projectMode && candidate.id !== activeOnBoardAfterRelease.id) {
          blockingError = `Multi-night project "${activeOnBoardAfterRelease.target}" is above 30°; the next project runs when it is below 30°.`
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
      activeOnBoardAfterRelease ?? projectForSubDeliveryFresh
    )

    if (projectForSubDeliveryFresh && shouldDeliverProjectSubSessionDirect(projectForSubDeliveryFresh, pending)) {
      const delivered = await tryDeliverProjectSubSessionTonight(
        status,
        nightKey,
        projectForSubDeliveryFresh,
        activeOnBoardAfterRelease,
        allowRedeliverInProgress
      )
      if (delivered) return delivered
    }

    if (scheduledTonight.length > 0 && remainingTonight) {
      if (activeOnBoardAfterRelease) {
        const onBoardNight = getNightForNinaDelivery(activeOnBoardAfterRelease, nightKey, {
          allowRedeliverInProgress,
        })
        if (onBoardNight?.ninaSequenceJson) {
          const delivered = await tryDeliverProjectSubSessionTonight(
            status,
            nightKey,
            activeOnBoardAfterRelease,
            activeOnBoardAfterRelease,
            allowRedeliverInProgress
          )
          if (delivered) return delivered
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

    if (remainingTonight) {
      const stuckProject = activeOnBoardAfterRelease ?? projectForSubDeliveryFresh
      if (
        stuckProject &&
        allowRedeliverInProgress &&
        shouldDeliverProjectSubSessionDirect(stuckProject, pending)
      ) {
        const delivered = await tryDeliverProjectSubSessionTonight(
          status,
          nightKey,
          stuckProject,
          activeOnBoardAfterRelease,
          allowRedeliverInProgress
        )
        if (delivered) return delivered
      }
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
    if (selected.projectMode) {
      const project = await getProjectById(selected.id)
      if (project && shouldDeliverProjectSubSessionDirect(project, pending)) {
        const delivered = await tryDeliverProjectSubSessionTonight(
          status,
          nightKey,
          project,
          activeOnBoardAfterRelease,
          allowRedeliverInProgress
        )
        if (delivered) return delivered
      }
    }
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

  if (consumed.projectMode) {
    const project = await getProjectById(consumed.id)
    const night = project ? getDeliverableNight(project, nightKey) : undefined
    if (!night?.ninaSequenceJson) {
      return NextResponse.json(
        { error: 'Project sub-session sequence not available for download' },
        { status: 404, headers: imagingCorsHeadersResolved() }
      )
    }
    return deliverProjectSubSessionJson(
      project!,
      night,
      `NINA project sub-session delivered: ${project!.target} Session ${night.nightIndex} (${night.id}).`
    )
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
    userId: consumed.userId,
  })

  const startedAtIso = new Date().toISOString()
  void sendSessionStartedEmail({
    queueId: consumed.id,
    target: consumed.target,
    email: consumed.email,
    firstName: consumed.firstName,
    startedAtIso,
  }).then((result) => {
    if (!result.sent) {
      return appendAuditLog({
        kind: 'session.progress',
        message: `Start email skipped/failed for ${consumed.id}: ${result.reason ?? 'unknown reason'}`,
        detail: { queueId: consumed.id, reason: result.reason ?? null },
      })
    }
    return appendAuditLog({
      kind: 'session.progress',
      message: `Start email sent for ${consumed.id}.`,
      detail: { queueId: consumed.id, email: consumed.email ?? null },
    })
  })

  void appendAuditLog({
    kind: 'nina.delivered',
    message: `NINA sequence delivered (scheduled queue, planned-start order) and removed from queue: ${consumed.target} (${consumed.id}).`,
    detail: {
      id: consumed.id,
      target: consumed.target,
      exposureSeconds: consumed.exposureSeconds,
      count: consumed.count,
      projectMode: false,
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
