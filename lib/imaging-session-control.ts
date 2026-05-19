import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendCompletionEmail, sendSessionFailedEmail } from '@/lib/imaging-completion-email'
import { publishProgress } from '@/lib/imaging-progress-live'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import {
  deleteProjectById,
  getProjectById,
  getProjectByNightSubId,
  listProjects,
  markNightCompleted,
  markNightFailed,
  removeProjectNight,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { adminForceQueueStatus, deleteRequestById, getRequestById, listAll } from '@/lib/imaging-queue-store'
import {
  boardMarkCompleted,
  boardMarkFailed,
  boardRemove,
  getBoardEntry,
  listBoardEntries,
} from '@/lib/imaging-session-board'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

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
  'in_progress',
  'completed',
  'failed',
  'planned',
])

function nightStatusLabel(n: ProjectNight): string {
  return n.status === 'planned' ? 'scheduled' : n.status
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
      status: r.status,
      kind: 'normal',
      plannedStartIso: r.plannedStartIso ?? null,
      updatedAt: r.updatedAt,
    })
  }

  for (const p of projects) {
    if (!p.onBoard) continue
    if (queue.some((r) => r.id === p.id)) continue
    for (const night of p.nights) {
      const status = nightStatusLabel(night)
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
    if (result.projectCompleted) {
      const board = await getBoardEntry(match.project.id)
      if (board?.status === 'in_progress') {
        await boardMarkCompleted(match.project.id)
      }
      void sendCompletionEmail({
        queueId: match.project.id,
        target: match.project.target,
        email: match.project.email,
        firstName: match.project.firstName,
        completedAtIso: new Date().toISOString(),
      })
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
    void sendSessionFailedEmail({
      queueId: sessionId,
      target: match.project.target,
      email: match.project.email,
      firstName: match.project.firstName,
      failedAtIso: new Date().toISOString(),
    })
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
      await deleteRequestById(match.project.id)
      await boardRemove(match.project.id)
      await deleteProjectById(match.project.id)
      await deleteR2ObjectForQueueId(match.project.id)
      await removePreviewImage(match.project.id)
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

  await deleteRequestById(sessionId)
  await boardRemove(sessionId)
  await deleteR2ObjectForQueueId(sessionId)
  await removePreviewImage(sessionId)
  const projectRemoved = await deleteProjectById(sessionId)

  void appendAuditLog({
    kind: 'queue.deleted',
    message: `Admin deleted session ${sessionId}.`,
    detail: { id: sessionId, projectRecordRemoved: projectRemoved },
  })
  void reconcilePendingScheduleStatus()
  return { ok: true }
}
