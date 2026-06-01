import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionFailedEmail } from '@/lib/imaging-completion-email'
import { sendObservatoryDisconnectedAlertEmail } from '@/lib/observatory-alert-email'
import { publishProgress } from '@/lib/imaging-progress-live'
import { listProjects, markNightFailed } from '@/lib/imaging-project-store'
import { notifyProjectNightFailedEmail } from '@/lib/imaging-project-night-email'
import { getInProgressProjectNightSubId } from '@/lib/imaging-session-progress-queue'
import {
  boardFailAllInProgress,
  getBoardEntry,
  listBoardEntries,
  type FailedBoardSnapshot,
} from '@/lib/imaging-session-board'
import type { ObservatoryStatus } from '@/lib/observatory-status-store'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

export const SESSION_FAILED_TERMINAL_MESSAGE = 'Session failed -- contact support.'

const LAST_STATUS_KEY = 'observatory-status-last-final'

type LastStatusPayload = { status: ObservatoryStatus; at: string }

type GlobalWithLastStatus = typeof globalThis & {
  __pomfret_observatory_last_final_status__?: ObservatoryStatus
}

async function readLastFinalStatus(): Promise<ObservatoryStatus | null> {
  if (kvEnabled()) {
    const remote = await kvGetJson<LastStatusPayload>(LAST_STATUS_KEY)
    if (remote && typeof remote.status === 'string') return remote.status
  }
  const g = globalThis as GlobalWithLastStatus
  return g.__pomfret_observatory_last_final_status__ ?? null
}

async function writeLastFinalStatus(status: ObservatoryStatus): Promise<void> {
  if (kvEnabled()) {
    const ok = await kvSetJson(LAST_STATUS_KEY, { status, at: new Date().toISOString() })
    if (ok) return
  }
  const g = globalThis as GlobalWithLastStatus
  g.__pomfret_observatory_last_final_status__ = status
}

async function recordSessionFailure(queueId: string, reason: string): Promise<void> {
  const at = new Date().toISOString()
  await appendAuditLog({
    kind: 'session.progress',
    message: SESSION_FAILED_TERMINAL_MESSAGE,
    detail: { queueId, reason, message: SESSION_FAILED_TERMINAL_MESSAGE },
  })
  publishProgress(queueId, { type: 'line', at, text: SESSION_FAILED_TERMINAL_MESSAGE })
  publishProgress(queueId, { type: 'status', queueStatus: 'failed' })
}

async function notifySessionFailed(snapshot: FailedBoardSnapshot, reason: string): Promise<void> {
  const board = await getBoardEntry(snapshot.id)
  let queueId = snapshot.id
  if (board?.projectMode) {
    const nightId = await getInProgressProjectNightSubId(snapshot.id)
    if (nightId) {
      await markNightFailed(snapshot.id, nightId)
      queueId = nightId
    }
  }

  await recordSessionFailure(queueId, reason)
  void appendAuditLog({
    kind: 'queue.status',
    message: `Session ${queueId} marked failed (${reason}).`,
    detail: { id: queueId, boardId: snapshot.id, reason },
  })

  const mailCtx = {
    queueId,
    target: snapshot.target,
    email: snapshot.email,
    firstName: snapshot.firstName,
  }
  if (board?.projectMode && queueId !== snapshot.id) {
    notifyProjectNightFailedEmail(mailCtx, snapshot.failedAt)
    return
  }

  void sendSessionFailedEmail({ ...mailCtx, failedAtIso: snapshot.failedAt }).then((result) => {
    if (!result.sent) {
      return appendAuditLog({
        kind: 'session.progress',
        message: `Failure email skipped/failed for ${queueId}: ${result.reason ?? 'unknown reason'}`,
        detail: { queueId, reason: result.reason ?? null },
      })
    }
    return appendAuditLog({
      kind: 'session.progress',
      message: `Failure email sent for ${queueId}.`,
      detail: { queueId, email: snapshot.email ?? null },
    })
  })
}

/** Project board rows are containers; busy→ready fails the active sub-session, not the board row. */
export async function inactiveProjectBoardSkipIds(): Promise<Set<string>> {
  const skip = new Set<string>()
  for (const entry of await listBoardEntries()) {
    if (entry.projectMode === true) skip.add(entry.id)
  }
  return skip
}

/** Same rule as normal board `in_progress` on busy→ready, applied per project sub-session id. */
export async function failInProgressProjectSubSessions(reason: string): Promise<string[]> {
  const failed: string[] = []
  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (night.status !== 'in_progress') continue
      await markNightFailed(project.id, night.id)
      await recordSessionFailure(night.id, reason)
      failed.push(night.id)
      void appendAuditLog({
        kind: 'queue.status',
        message: `Project sub-session ${night.id} marked failed (${reason}).`,
        detail: { sessionId: night.id, projectId: project.id, reason },
      })
      notifyProjectNightFailedEmail(
        {
          queueId: night.id,
          target: project.target,
          email: project.email,
          firstName: project.firstName,
        },
        new Date().toISOString()
      )
    }
  }
  return failed
}

/** Mark every board `in_progress` row failed and push the red terminal line. */
export async function failInProgressBoardSessions(
  exceptId: string | undefined,
  reason: string
): Promise<string[]> {
  const skipIds = await inactiveProjectBoardSkipIds()
  const failed = await boardFailAllInProgress(exceptId, skipIds)
  for (const snapshot of failed) {
    await notifySessionFailed(snapshot, reason)
  }
  return failed.map((s) => s.id)
}

/**
 * When the observatory leaves Busy for Ready while a session is still `in_progress` on the board
 * (no Session Completed POST), treat it as an abort / NINA exit.
 */
export async function onObservatoryFinalStatusChanged(final: ObservatoryStatus): Promise<void> {
  const previous = await readLastFinalStatus()
  if (previous !== 'disconnected' && final === 'disconnected') {
    void sendObservatoryDisconnectedAlertEmail().then((result) => {
      if (!result.sent) {
        return appendAuditLog({
          kind: 'observatory.alert_email',
          message: `Disconnected alert email skipped/failed: ${result.reason ?? 'unknown reason'}`,
          detail: { sent: false, reason: result.reason ?? null, recipients: result.recipients ?? [] },
        })
      }
      return appendAuditLog({
        kind: 'observatory.alert_email',
        message: 'Disconnected alert email sent to observatory administrators.',
        detail: { sent: true, recipients: result.recipients ?? [] },
      })
    })
  }
  if (previous === 'busy_in_use' && final === 'ready') {
    await failInProgressProjectSubSessions('observatory_busy_to_ready')
    await failInProgressBoardSessions(undefined, 'observatory_busy_to_ready')
  }
  await writeLastFinalStatus(final)
}
