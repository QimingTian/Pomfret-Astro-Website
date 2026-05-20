import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionFailedEmail } from '@/lib/imaging-completion-email'
import { publishProgress } from '@/lib/imaging-progress-live'
import { markNightFailed } from '@/lib/imaging-project-store'
import { notifyProjectNightFailedEmail } from '@/lib/imaging-project-night-email'
import { getInProgressProjectNightSubId } from '@/lib/imaging-session-progress-queue'
import {
  boardFailAllInProgress,
  getBoardEntry,
  listBoardEntries,
  type FailedBoardSnapshot,
  type SessionBoardEntry,
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

/**
 * Multi-night projects stay `in_progress` on the board between sub-sessions. Do not treat them as
 * aborted when no sub-session is actively imaging (e.g. after NINA Session Completed).
 */
export function shouldFailProjectModeBoardEntry(
  entry: Pick<SessionBoardEntry, 'projectMode'>,
  activeNightSubId: string | null
): boolean {
  if (entry.projectMode !== true) return true
  return activeNightSubId != null
}

/** Board project ids with no `in_progress` sub-session — parked between runs, not actively imaging. */
export async function inactiveProjectBoardSkipIds(): Promise<Set<string>> {
  const skip = new Set<string>()
  for (const entry of await listBoardEntries()) {
    if (entry.status !== 'in_progress' || entry.projectMode !== true) continue
    const activeNight = await getInProgressProjectNightSubId(entry.id)
    if (!shouldFailProjectModeBoardEntry(entry, activeNight)) skip.add(entry.id)
  }
  return skip
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
  if (previous === 'busy_in_use' && final === 'ready') {
    await failInProgressBoardSessions(undefined, 'observatory_busy_to_ready')
  }
  await writeLastFinalStatus(final)
}
