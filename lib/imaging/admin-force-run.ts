import { NextResponse } from 'next/server'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionStartedEmail } from '@/lib/imaging-completion-email'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import {
  buildNightNinaJson,
  getProjectByNightSubId,
  listProjects,
  markNightInProgress,
  markProjectOnBoard,
  patchProject,
  tonightDurationSecondsFromPlans,
  type ImagingProject,
  type ProjectNight,
  type ProjectSubSessionOccupancy,
} from '@/lib/imaging-project-store'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import {
  consumeRequestById,
  getRequestById,
  listAll,
  listPending,
  patchRequestAdminForceRun,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  type ImagingRequest,
} from '@/lib/imaging-queue-store'
import { estimateDurationSeconds } from '@/lib/imaging-queue-schedule-insight'
import { publishProgress } from '@/lib/imaging-progress-live'
import { failInProgressBoardSessions } from '@/lib/imaging-session-failure'
import { boardMarkDownloaded, boardUpsertInProgress } from '@/lib/imaging-session-board'
import { imagingCorsHeadersResolved } from '@/lib/imaging-queue-auth'
import type { ObservatoryStatus } from '@/lib/observatory-status-store'
import { getObservatoryStatus, isObservatoryReady } from '@/lib/observatory-status-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { validateAdminRunWeatherWindow } from '@/lib/tonight-weather-gate'
import {
  altitudeSessionCoverageOk,
  isAltitudeAllowed,
  MIN_ALTITUDE_DEG,
} from '@/lib/target-altitude'

export function isAdminForceRunActive(
  row: { adminForceRunUntilIso?: string | null },
  nowMs = Date.now()
): boolean {
  if (!row.adminForceRunUntilIso) return false
  const until = Date.parse(row.adminForceRunUntilIso)
  return Number.isFinite(until) && until > nowMs
}

/** Force-run requires target >= 30° now and for 100% of [startMs, endMs) (same rule as normal scheduling). */
export function validateAdminForceRunAltitude(
  raHours: number | null | undefined,
  decDeg: number | null | undefined,
  startMs: number,
  endMs: number,
  targetLabel: string
): { ok: true } | { ok: false; reason: string } {
  if (
    typeof raHours !== 'number' ||
    !Number.isFinite(raHours) ||
    typeof decDeg !== 'number' ||
    !Number.isFinite(decDeg)
  ) {
    return { ok: true }
  }
  const altNow = isAltitudeAllowed(raHours, decDeg)
  if (!altNow.ok) {
    return {
      ok: false,
      reason: `Target altitude ${altNow.altitudeDeg.toFixed(2)}° is below ${MIN_ALTITUDE_DEG}° (${targetLabel}).`,
    }
  }
  if (!altitudeSessionCoverageOk(raHours, decDeg, startMs, endMs)) {
    return {
      ok: false,
      reason: `Target is not at or above ${MIN_ALTITUDE_DEG}° for the full session duration (${targetLabel}).`,
    }
  }
  return { ok: true }
}

function altitudeErrorResponse(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 409, headers: imagingCorsHeadersResolved() })
}

export type AdminForceRunTimeWindow = { startMs: number; endMs: number }

function clipTonightWindow(
  startMs: number,
  endMs: number,
  windowStartMs: number,
  deadlineMs: number
): AdminForceRunTimeWindow | null {
  const overlapStart = Math.max(startMs, windowStartMs)
  const overlapEnd = Math.min(endMs, deadlineMs)
  if (overlapEnd <= overlapStart) return null
  return { startMs: overlapStart, endMs: overlapEnd }
}

/** Active admin force-run imaging window for a normal queue row (tonight clip). */
export function queueRowAdminForceRunWindow(
  row: Pick<
    ImagingRequest,
    | 'plannedStartIso'
    | 'adminForceRunUntilIso'
    | 'estimatedDurationSeconds'
    | 'exposureSeconds'
    | 'count'
    | 'filterPlans'
  >,
  windowStartMs: number,
  deadlineMs: number,
  nowMs = Date.now()
): AdminForceRunTimeWindow | null {
  if (!isAdminForceRunActive(row, nowMs) || !row.plannedStartIso) return null
  const startMs = Date.parse(row.plannedStartIso)
  if (!Number.isFinite(startMs)) return null
  const untilMs = row.adminForceRunUntilIso ? Date.parse(row.adminForceRunUntilIso) : NaN
  const endMs =
    Number.isFinite(untilMs) && untilMs > startMs
      ? untilMs
      : startMs + estimateDurationSeconds(row) * 1000
  return clipTonightWindow(startMs, endMs, windowStartMs, deadlineMs)
}

/** Active admin force-run imaging window for a project sub-session (tonight clip). */
export function projectNightAdminForceRunWindow(
  night: ProjectNight,
  windowStartMs: number,
  deadlineMs: number,
  nowMs = Date.now()
): AdminForceRunTimeWindow | null {
  if (!isAdminForceRunActive(night, nowMs) || !night.plannedStartIso) return null
  if (night.status !== 'scheduled' && night.status !== 'in_progress') return null
  const startMs = Date.parse(night.plannedStartIso)
  if (!Number.isFinite(startMs)) return null
  const untilMs = night.adminForceRunUntilIso ? Date.parse(night.adminForceRunUntilIso) : NaN
  const endMs =
    Number.isFinite(untilMs) && untilMs > startMs
      ? untilMs
      : startMs + tonightDurationSecondsFromPlans(night.filterPlansTonight) * 1000
  return clipTonightWindow(startMs, endMs, windowStartMs, deadlineMs)
}

/** All active force-run windows tonight (normal queue rows + project subs). */
export async function collectActiveAdminForceRunOccupancies(
  nightKey: string,
  windowStartMs: number,
  deadlineMs: number,
  nowMs = Date.now()
): Promise<AdminForceRunTimeWindow[]> {
  const out: AdminForceRunTimeWindow[] = []
  for (const row of await listAll()) {
    if (row.projectMode || row.status !== 'scheduled') continue
    const window = queueRowAdminForceRunWindow(row, windowStartMs, deadlineMs, nowMs)
    if (window) out.push(window)
  }
  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (night.nightKey !== nightKey) continue
      const window = projectNightAdminForceRunWindow(night, windowStartMs, deadlineMs, nowMs)
      if (window) out.push(window)
    }
  }
  return out
}

export function subtractAdminForceRunsFromFree(
  freeIntervals: AdminForceRunTimeWindow[],
  forceRunOccupancy: AdminForceRunTimeWindow[]
): AdminForceRunTimeWindow[] {
  let free = freeIntervals
  for (const occupied of forceRunOccupancy) {
    free = subtractOccupiedFromFree(free, occupied)
  }
  return free
}

/** Normal-queue force-run rows as sub-session occupancy for schedule insight (project subs use collectTonight). */
export async function collectActiveAdminForceRunSubSessionOccupancy(
  windowStartMs: number,
  deadlineMs: number,
  nowMs = Date.now()
): Promise<ProjectSubSessionOccupancy[]> {
  const out: ProjectSubSessionOccupancy[] = []
  for (const row of await listAll()) {
    if (row.projectMode || row.status !== 'scheduled') continue
    if (!isAdminForceRunActive(row, nowMs) || !row.plannedStartIso) continue
    const startMs = Date.parse(row.plannedStartIso)
    if (!Number.isFinite(startMs)) continue
    const endMs = startMs + estimateDurationSeconds(row) * 1000
    const clip = clipTonightWindow(startMs, endMs, windowStartMs, deadlineMs)
    if (!clip) continue
    out.push({
      projectId: row.id,
      target: row.target,
      nightIndex: 0,
      startMs: clip.startMs,
      endMs: clip.endMs,
    })
  }
  return out
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

async function deliverForceRunProjectSub(
  project: ImagingProject,
  night: ProjectNight
): Promise<NextResponse> {
  if (!night.ninaSequenceJson) {
    return NextResponse.json(
      { error: 'Project sub-session sequence not available for download' },
      { status: 404, headers: imagingCorsHeadersResolved() }
    )
  }
  if (night.status !== 'scheduled' && night.status !== 'in_progress') {
    return NextResponse.json(
      { error: 'Admin force-run sub-session is not scheduled for delivery.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  if (!isAdminForceRunActive(night)) {
    return NextResponse.json(
      { error: 'Admin force-run has expired for this sub-session.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const startMs = Date.parse(night.plannedStartIso ?? '')
  const durationSeconds = tonightDurationSecondsFromPlans(night.filterPlansTonight)
  const endMs = startMs + durationSeconds * 1000
  if (!Number.isFinite(startMs) || endMs <= startMs) {
    return NextResponse.json(
      { error: 'Admin force-run sub-session has an invalid planned window.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  const altitude = validateAdminForceRunAltitude(
    project.raHours,
    project.decDeg,
    startMs,
    endMs,
    project.target
  )
  if (!altitude.ok) return altitudeErrorResponse(altitude.reason)

  if (!project.onBoard) {
    await markProjectOnBoard(project.id)
  }
  const redeliver = night.status === 'in_progress'
  if (!redeliver) {
    await markNightInProgress(project.id, night.id)
    const startedAtIso = new Date().toISOString()
    await boardUpsertInProgress({
      id: project.id,
      target: project.target,
      createdAt: project.createdAt,
      firstName: project.firstName ?? null,
      lastName: project.lastName ?? null,
      email: project.email ?? null,
      raHours: project.raHours,
      decDeg: project.decDeg,
      filter: night.filterPlansTonight[0]?.filterName ?? project.filterPlansTotal[0]?.filterName ?? null,
      exposureSeconds:
        night.filterPlansTonight[0]?.exposureSeconds ??
        project.filterPlansTotal[0]?.exposureSeconds,
      count: night.filterPlansTonight[0]?.count ?? 0,
      outputMode: project.outputMode,
      filterPlans: project.filterPlansTotal,
      estimatedDurationSeconds: tonightDurationSecondsFromPlans(night.filterPlansTonight),
      sessionPasswordHash: project.sessionPasswordHash,
      userId: project.userId,
      projectMode: true,
    })
    await boardMarkDownloaded(project.id)
    void sendSessionStartedEmail({
      queueId: night.id,
      target: project.target,
      email: project.email,
      firstName: project.firstName,
      startedAtIso,
    })
    publishProgress(night.id, { type: 'status', queueStatus: 'in_progress' })
  } else {
    await boardMarkDownloaded(project.id)
  }

  void appendAuditLog({
    kind: redeliver ? 'nina.redelivered' : 'nina.delivered',
    message: `NINA admin force-run delivered: ${project.target} Session ${night.nightIndex} (${night.id}).`,
    detail: { projectId: project.id, subSessionId: night.id, adminForceRun: true, redeliver },
  })

  return new NextResponse(night.ninaSequenceJson, {
    status: 200,
    headers: {
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function deliverForceRunQueueRow(row: ImagingRequest): Promise<NextResponse> {
  if (row.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Admin force-run session is not scheduled for delivery.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  if (!isAdminForceRunActive(row)) {
    return NextResponse.json(
      { error: 'Admin force-run has expired for this session.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const startMs = Date.parse(row.plannedStartIso ?? '')
  const durationSeconds = estimateDurationSeconds(row)
  const endMs = startMs + durationSeconds * 1000
  if (!Number.isFinite(startMs) || endMs <= startMs) {
    return NextResponse.json(
      { error: 'Admin force-run session has an invalid planned window.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }
  const altitude = validateAdminForceRunAltitude(row.raHours, row.decDeg, startMs, endMs, row.target)
  if (!altitude.ok) return altitudeErrorResponse(altitude.reason)

  const sequenceJson = sequenceJsonFor(row)
  if (!sequenceJson) {
    return NextResponse.json(
      { error: 'NINA sequence not available for this session.' },
      { status: 404, headers: imagingCorsHeadersResolved() }
    )
  }

  await failInProgressBoardSessions(undefined, 'interrupted_before_admin_force_run_delivery')
  const consumed = await consumeRequestById(row.id)
  if (!consumed) {
    return NextResponse.json(
      { error: 'Session could not be consumed for NINA delivery (queue may have changed).' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const startedAtIso = new Date().toISOString()
  await boardUpsertInProgress({
    id: consumed.id,
    target: consumed.target,
    createdAt: consumed.createdAt,
    firstName: consumed.firstName ?? null,
    lastName: consumed.lastName ?? null,
    email: consumed.email ?? null,
    raHours: consumed.raHours,
    decDeg: consumed.decDeg,
    filter: consumed.filter,
    exposureSeconds: consumed.exposureSeconds,
    count: consumed.count,
    outputMode: consumed.outputMode,
    filterPlans: consumed.filterPlans,
    estimatedDurationSeconds: consumed.estimatedDurationSeconds,
    sessionPasswordHash: consumed.sessionPasswordHash,
    userId: consumed.userId,
    projectMode: consumed.projectMode,
  })
  await boardMarkDownloaded(consumed.id)
  void sendSessionStartedEmail({
    queueId: consumed.id,
    target: consumed.target,
    email: consumed.email,
    firstName: consumed.firstName,
    startedAtIso,
  })
  publishProgress(consumed.id, { type: 'status', queueStatus: 'in_progress' })

  void appendAuditLog({
    kind: 'nina.delivered',
    message: `NINA admin force-run delivered: ${consumed.target} (${consumed.id}).`,
    detail: { queueId: consumed.id, adminForceRun: true },
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

/** Deliver JSON for an active admin force-run session (moon/hold bypass only; altitude rules apply). */
export async function tryDeliverAdminForceRunSession(
  status: ObservatoryStatus,
  forceRunSessionId: string
): Promise<NextResponse | null> {
  if (!isObservatoryReady(status)) {
    return NextResponse.json(
      { error: 'Observatory is closed' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  const nightSub = parseProjectNightSubId(forceRunSessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(forceRunSessionId)
    if (!match) return null
    const { project, night } = match
    if (night.id !== forceRunSessionId || !isAdminForceRunActive(night)) return null
    return deliverForceRunProjectSub(project, night)
  }

  const row = await getRequestById(forceRunSessionId)
  if (!row || !isAdminForceRunActive(row)) return null
  return deliverForceRunQueueRow(row)
}

/** If any session is in an active admin force-run window, deliver it before normal NINA selection. */
export async function tryDeliverActiveAdminForceRun(
  status: ObservatoryStatus,
  nowMs = Date.now()
): Promise<NextResponse | null> {
  const candidates: Array<{ id: string; startMs: number }> = []

  for (const r of await listPending()) {
    if (!isAdminForceRunActive(r, nowMs) || r.status !== 'scheduled' || !r.plannedStartIso) continue
    const startMs = Date.parse(r.plannedStartIso)
    if (!Number.isFinite(startMs)) continue
    candidates.push({ id: r.id, startMs })
  }

  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (!isAdminForceRunActive(night, nowMs)) continue
      if (night.status !== 'scheduled' && night.status !== 'in_progress') continue
      if (!night.plannedStartIso) continue
      const startMs = Date.parse(night.plannedStartIso)
      if (!Number.isFinite(startMs)) continue
      candidates.push({ id: night.id, startMs })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.startMs - b.startMs)
  return tryDeliverAdminForceRunSession(status, candidates[0]!.id)
}

const RUNNABLE_STATUSES = new Set(['pending', 'scheduled', 'planned'])

export async function adminRunSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const obsStatus = await getObservatoryStatus()
  if (!isObservatoryReady(obsStatus)) {
    return { error: 'Observatory is not ready' }
  }

  const now = new Date()
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const strip = getTonightScheduleStrip(now)
  const nightKey = strip.nightKey
  const deadlineMs = getTonightSchedulingWindow(now).nauticalDawnUtc.getTime()

  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    const { project, night } = match
    const statusLabel = night.status === 'planned' ? 'scheduled' : night.status
    if (!RUNNABLE_STATUSES.has(night.status)) {
      return { error: `Cannot force-run sub-session in status "${statusLabel}".` }
    }
    if (night.filterPlansTonight.length === 0) {
      return { error: 'Sub-session has no imaging plan for tonight.' }
    }
    const durationSeconds = tonightDurationSecondsFromPlans(night.filterPlansTonight)
    if (durationSeconds <= 0) return { error: 'Could not estimate sub-session duration.' }
    const endMs = nowMs + durationSeconds * 1000
    if (endMs > deadlineMs) {
      return { error: 'Session would extend past nautical dawn.' }
    }

    const altitude = validateAdminForceRunAltitude(
      project.raHours,
      project.decDeg,
      nowMs,
      endMs,
      project.target
    )
    if (!altitude.ok) return { error: altitude.reason }

    const weather = await validateAdminRunWeatherWindow(nowMs, endMs)
    if (!weather.ok) return { error: weather.reason }

    const ninaSequenceJson =
      night.ninaSequenceJson ?? buildNightNinaJson(project, night.id, night.filterPlansTonight)
    const adminForceRunUntilIso = new Date(endMs).toISOString()

    const nights = project.nights.map((n) =>
      n.id === sessionId
        ? {
            ...n,
            status: 'scheduled' as const,
            nightKey,
            plannedStartIso: nowIso,
            adminForceRunUntilIso,
            ninaSequenceJson,
          }
        : n
    )
    const updated = await patchProject(project.id, { nights })
    if (!updated) return { error: 'Could not update sub-session.' }

    void appendAuditLog({
      kind: 'queue.admin_run',
      message: `Admin force-run started: ${project.target} Session ${night.nightIndex} (${sessionId}).`,
      detail: {
        sessionId,
        projectId: project.id,
        plannedStartIso: nowIso,
        adminForceRunUntilIso,
      },
    })

    const { reconcilePendingScheduleStatus } = await import('@/lib/imaging-queue-reconcile')
    await reconcilePendingScheduleStatus()
    return { ok: true }
  }

  const row = await getRequestById(sessionId)
  if (!row) return { error: 'Session not found' }
  if (row.projectMode) {
    return { error: 'Use the project sub-session id (Session N), not the project queue id.' }
  }
  if (!RUNNABLE_STATUSES.has(row.status)) {
    return { error: `Cannot force-run session in status "${row.status}".` }
  }

  const durationSeconds = estimateDurationSeconds(row)
  const endMs = nowMs + durationSeconds * 1000
  if (endMs > deadlineMs) {
    return { error: 'Session would extend past nautical dawn.' }
  }

  const altitude = validateAdminForceRunAltitude(row.raHours, row.decDeg, nowMs, endMs, row.target)
  if (!altitude.ok) return { error: altitude.reason }

  const weather = await validateAdminRunWeatherWindow(nowMs, endMs)
  if (!weather.ok) return { error: weather.reason }

  const adminForceRunUntilIso = new Date(endMs).toISOString()
  const patched = await patchRequestAdminForceRun(sessionId, {
    plannedStartIso: nowIso,
    adminForceRunUntilIso,
  })
  if (!patched) return { error: 'Could not update session.' }

  void appendAuditLog({
    kind: 'queue.admin_run',
    message: `Admin force-run started: ${row.target} (${sessionId}).`,
    detail: {
      sessionId,
      plannedStartIso: nowIso,
      adminForceRunUntilIso,
    },
  })

  const { reconcilePendingScheduleStatus } = await import('@/lib/imaging-queue-reconcile')
  await reconcilePendingScheduleStatus()
  return { ok: true }
}
