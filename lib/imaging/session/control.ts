import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionFailedEmail } from '@/lib/imaging-completion-email'
import {
  notifyProjectNightCompletionEmail,
  notifyProjectNightFailedEmail,
} from '@/lib/imaging-project-night-email'
import { publishProgress } from '@/lib/imaging-progress-live'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import {
  deleteProjectById,
  getProjectById,
  getProjectByNightSubId,
  isProjectVisibleToOperators,
  listProjects,
  markNightCompleted,
  markNightFailed,
  markNightInProgress,
  removeProjectNight,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import {
  adminForceQueueStatus,
  adminRestoreQueueFromFailed,
  deleteRequestById,
  getRequestById,
  listAll,
} from '@/lib/imaging-queue-store'
import {
  boardMarkCompleted,
  boardMarkFailed,
  boardRemove,
  boardReviveInProgress,
  getBoardEntry,
  listBoardEntries,
} from '@/lib/imaging-session-board'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'
import { deleteProjectCascade } from '@/lib/imaging-project-delete'
import { adminRunSession } from '@/lib/imaging/admin-force-run'
import { adminHoldSession, adminReleaseSessionHold } from '@/lib/imaging/session-hold'

export type SessionControlEntry = {
  sessionId: string
  label: string
  target: string
  status: string
  kind: 'normal' | 'project_sub'
  projectId?: string
  nightIndex?: number
  plannedStartIso?: string | null
  updatedAt: string
}

const ACTIVE_STATUSES = new Set([
  'pending',
  'scheduled',
  'on_hold',
  'in_progress',
  'completed',
  'failed',
  'planned',
])

function nightStatusLabel(n: ProjectNight): string {
  if (n.status === 'on_hold') return 'on hold'
  return n.status === 'planned' ? 'scheduled' : n.status
}

/** Another observatory run already in progress (not `exceptSessionId`). */
async function findOtherInProgressSession(exceptSessionId: string): Promise<string | null> {
  const exceptParsed = parseProjectNightSubId(exceptSessionId)

  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (night.status === 'in_progress' && night.id !== exceptSessionId) {
        return night.id
      }
    }
  }

  for (const b of await listBoardEntries()) {
    if (b.status !== 'in_progress' || b.id === exceptSessionId) continue
    if (exceptParsed && b.projectMode && b.id === exceptParsed.projectId) continue
    return b.id
  }

  for (const r of await listAll()) {
    if (r.status !== 'in_progress' || r.id === exceptSessionId) continue
    if (exceptParsed && r.id === exceptParsed.projectId) continue
    return r.id
  }

  return null
}

async function assertNoOtherInProgress(
  exceptSessionId: string
): Promise<{ error: string } | null> {
  const blocking = await findOtherInProgressSession(exceptSessionId)
  if (!blocking) return null
  return {
    error: `Another session is already in progress (${blocking}). Complete or fail it before restoring this session.`,
  }
}

export async function listSessionControlEntries(): Promise<SessionControlEntry[]> {
  const [queue, board, projects] = await Promise.all([listAll(), listBoardEntries(), listProjects()])
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const entries: SessionControlEntry[] = []
  const seen = new Set<string>()

  function push(entry: SessionControlEntry) {
    if (seen.has(entry.sessionId)) return
    seen.add(entry.sessionId)
    entries.push(entry)
  }

  for (const r of queue) {
    const project = projectById.get(r.id)
    if (project?.projectMode && project.nights.length > 0) {
      for (const night of project.nights) {
        const status = nightStatusLabel(night)
        if (!ACTIVE_STATUSES.has(status) && !ACTIVE_STATUSES.has(night.status)) continue
        push({
          sessionId: night.id,
          label: `${project.target} — Session ${night.nightIndex}`,
          target: project.target,
          status,
          kind: 'project_sub',
          projectId: project.id,
          nightIndex: night.nightIndex,
          plannedStartIso: night.plannedStartIso ?? null,
          updatedAt: project.updatedAt,
        })
      }
      continue
    }
    if (!ACTIVE_STATUSES.has(r.status)) continue
    push({
      sessionId: r.id,
      label: r.target,
      target: r.target,
      status: r.status === 'on_hold' ? 'on hold' : r.status,
      kind: 'normal',
      plannedStartIso: r.plannedStartIso ?? null,
      updatedAt: r.updatedAt,
    })
  }

  for (const p of projects) {
    if (queue.some((r) => r.id === p.id)) continue
    if (!(await isProjectVisibleToOperators(p))) continue
    for (const night of p.nights) {
      const status = nightStatusLabel(night)
      if (!p.onBoard && !ACTIVE_STATUSES.has(status) && !ACTIVE_STATUSES.has(night.status)) continue
      push({
        sessionId: night.id,
        label: `${p.target} — Session ${night.nightIndex}`,
        target: p.target,
        status,
        kind: 'project_sub',
        projectId: p.id,
        nightIndex: night.nightIndex,
        plannedStartIso: night.plannedStartIso ?? null,
        updatedAt: p.updatedAt,
      })
    }
  }

  for (const b of board) {
    if (projectById.has(b.id)) continue
    if (seen.has(b.id)) continue
    if (!ACTIVE_STATUSES.has(b.status)) continue
    push({
      sessionId: b.id,
      label: b.target,
      target: b.target,
      status: b.status,
      kind: 'normal',
      plannedStartIso: null,
      updatedAt: b.updatedAt,
    })
  }

  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return entries
}

export async function adminMarkSessionComplete(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    const result = await markNightCompleted(match.project.id, sessionId)
    if (!result) return { error: 'Could not mark sub-session completed' }
    publishProgress(sessionId, { type: 'status', queueStatus: 'completed' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin marked project sub-session ${sessionId} completed.`,
      detail: { sessionId, projectId: match.project.id, nightIndex: match.night.nightIndex },
    })
    notifyProjectNightCompletionEmail(
      {
        queueId: sessionId,
        target: match.project.target,
        email: match.project.email,
        firstName: match.project.firstName,
      },
      new Date().toISOString()
    )
    if (result.projectCompleted) {
      const board = await getBoardEntry(match.project.id)
      if (board?.status === 'in_progress') {
        await boardMarkCompleted(match.project.id)
      }
      publishProgress(match.project.id, { type: 'status', queueStatus: 'completed' })
    }
    void reconcilePendingScheduleStatus()
    return { ok: true }
  }

  const board = await getBoardEntry(sessionId)
  if (board?.status === 'in_progress') {
    const ok = await boardMarkCompleted(sessionId)
    if (!ok) return { error: 'Could not mark board session completed' }
    publishProgress(sessionId, { type: 'status', queueStatus: 'completed' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin marked session ${sessionId} completed.`,
      detail: { id: sessionId, target: board.target },
    })
    return { ok: true }
  }

  const forced = await adminForceQueueStatus(sessionId, 'completed')
  if ('error' in forced) {
    const inQueue = await getRequestById(sessionId)
    if (!inQueue && !board) return { error: 'Session not found' }
    return forced
  }
  publishProgress(sessionId, { type: 'status', queueStatus: 'completed' })
  void appendAuditLog({
    kind: 'queue.status',
    message: `Admin marked session ${sessionId} completed.`,
    detail: { id: sessionId, target: forced.target },
  })
  return { ok: true }
}

export async function adminMarkSessionInProgress(
  sessionId: string
): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) {
      return { error: 'Sub-session not found' }
    }
    if (match.night.status === 'in_progress') {
      return { ok: true }
    }
    const canRestore =
      match.night.status === 'failed' ||
      (match.night.status === 'scheduled' && Boolean(match.night.ninaDeliveredAt))
    if (!canRestore) {
      return {
        error: `Only failed sub-sessions (or scheduled subs already delivered to NINA) can be set in progress (current: ${match.night.status}).`,
      }
    }
    const blocked = await assertNoOtherInProgress(sessionId)
    if (blocked) return blocked
    await markNightInProgress(match.project.id, sessionId)
    publishProgress(sessionId, { type: 'status', queueStatus: 'in_progress' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin restored project sub-session ${sessionId} to in_progress.`,
      detail: { sessionId, projectId: match.project.id, nightIndex: match.night.nightIndex },
    })
    void reconcilePendingScheduleStatus()
    return { ok: true }
  }

  const board = await getBoardEntry(sessionId)
  if (board?.status === 'failed') {
    const blocked = await assertNoOtherInProgress(sessionId)
    if (blocked) return blocked
    const ok = await boardReviveInProgress(sessionId)
    if (!ok) return { error: 'Could not restore board session to in progress' }
    publishProgress(sessionId, { type: 'status', queueStatus: 'in_progress' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin restored session ${sessionId} to in_progress.`,
      detail: { id: sessionId, target: board.target },
    })
    return { ok: true }
  }

  const inQueue = await getRequestById(sessionId)
  if (inQueue?.status === 'failed') {
    const blocked = await assertNoOtherInProgress(sessionId)
    if (blocked) return blocked
    const restored = await adminRestoreQueueFromFailed(sessionId)
    if ('error' in restored) return restored
    publishProgress(sessionId, { type: 'status', queueStatus: 'in_progress' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin restored session ${sessionId} to in_progress.`,
      detail: { id: sessionId, target: restored.target },
    })
    return { ok: true }
  }

  return { error: 'Session is not failed' }
}

export async function adminMarkSessionFailed(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    await markNightFailed(match.project.id, sessionId)
    publishProgress(sessionId, { type: 'status', queueStatus: 'failed' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin marked project sub-session ${sessionId} failed.`,
      detail: { sessionId, projectId: match.project.id, nightIndex: match.night.nightIndex },
    })
    notifyProjectNightFailedEmail(
      {
        queueId: sessionId,
        target: match.project.target,
        email: match.project.email,
        firstName: match.project.firstName,
      },
      new Date().toISOString()
    )
    void reconcilePendingScheduleStatus()
    return { ok: true }
  }

  const board = await getBoardEntry(sessionId)
  if (board?.status === 'in_progress') {
    const ok = await boardMarkFailed(sessionId)
    if (!ok) return { error: 'Could not mark board session failed' }
    publishProgress(sessionId, { type: 'status', queueStatus: 'failed' })
    void appendAuditLog({
      kind: 'queue.status',
      message: `Admin marked session ${sessionId} failed.`,
      detail: { id: sessionId, target: board.target },
    })
    void sendSessionFailedEmail({
      queueId: sessionId,
      target: board.target,
      email: board.email,
      firstName: board.firstName,
      failedAtIso: new Date().toISOString(),
    })
    return { ok: true }
  }

  const forced = await adminForceQueueStatus(sessionId, 'failed')
  if ('error' in forced) {
    if (!(await getRequestById(sessionId)) && !board) return { error: 'Session not found' }
    return forced
  }
  publishProgress(sessionId, { type: 'status', queueStatus: 'failed' })
  void appendAuditLog({
    kind: 'queue.status',
    message: `Admin marked session ${sessionId} failed.`,
    detail: { id: sessionId, target: forced.target },
  })
  void sendSessionFailedEmail({
    queueId: sessionId,
    target: forced.target,
    email: forced.email,
    firstName: forced.firstName,
    failedAtIso: new Date().toISOString(),
  })
  return { ok: true }
}

export async function adminDeleteSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    const removed = await removeProjectNight(match.project.id, sessionId)
    if (!removed) return { error: 'Could not remove sub-session' }
    await deleteR2ObjectForQueueId(sessionId)
    await removePreviewImage(sessionId)
    const remaining = await getProjectById(match.project.id)
    if (remaining && remaining.nights.length === 0) {
      await deleteProjectCascade(match.project.id)
    }
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Admin deleted project sub-session ${sessionId}.`,
      detail: { sessionId, projectId: match.project.id },
    })
    void reconcilePendingScheduleStatus()
    return { ok: true }
  }

  const inQueue = await getRequestById(sessionId)
  const onBoard = await getBoardEntry(sessionId)
  if (!inQueue && !onBoard) return { error: 'Session not found' }

  let projectRemoved = false
  if (inQueue?.projectMode === true || onBoard?.projectMode === true) {
    const cascade = await deleteProjectCascade(sessionId)
    projectRemoved = cascade.deletedProjectRecord
  } else {
    await deleteRequestById(sessionId)
    await boardRemove(sessionId)
    await deleteR2ObjectForQueueId(sessionId)
    await removePreviewImage(sessionId)
    projectRemoved = await deleteProjectById(sessionId)
  }

  void appendAuditLog({
    kind: 'queue.deleted',
    message: `Admin deleted session ${sessionId}.`,
    detail: { id: sessionId, projectRecordRemoved: projectRemoved },
  })
  void reconcilePendingScheduleStatus()
  return { ok: true }
}

export async function adminRunSessionControl(
  sessionId: string
): Promise<{ ok: true } | { error: string }> {
  return adminRunSession(sessionId)
}

export async function adminHoldSessionControl(
  sessionId: string
): Promise<{ ok: true } | { error: string }> {
  return adminHoldSession(sessionId)
}

export async function adminReleaseSessionHoldControl(
  sessionId: string
): Promise<{ ok: true } | { error: string }> {
  return adminReleaseSessionHold(sessionId)
}
