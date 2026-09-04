import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendSessionFailedEmail } from '@/lib/imaging-completion-email'
// import { sendObservatoryDisconnectedAlertEmail } from '@/lib/observatory-alert-email'
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
import { kvDel, kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'
import { lockObservatoryAfterSessionFailure } from '@/lib/imaging/session/failure-observatory-lock'

export const SESSION_FAILED_TERMINAL_MESSAGE = 'Session failed -- contact support.'

/** Grace after agent reports NINA stopped before failing in-progress sessions (Session Completed may lag). */
export const NINA_STOPPED_FAIL_GRACE_MS = 45_000

export const NINA_STOPPED_WITHOUT_COMPLETION_REASON = 'nina_stopped_without_completion'

export function isSessionFailedTerminalLine(text: string): boolean {
  return text.trim() === SESSION_FAILED_TERMINAL_MESSAGE
}

const NINA_REPORTED_LAST_BASE = 'observatory-nina-reported-last'
const NINA_STOPPED_PENDING_FAIL_BASE = 'observatory-nina-stopped-pending-fail'

/** One agent per observatory: NINA running/stopped must never cross sites. */
function ninaReportedLastKey(): string {
  return scopedKvKey(NINA_REPORTED_LAST_BASE)
}

function ninaStoppedPendingFailKey(): string {
  return scopedKvKey(NINA_STOPPED_PENDING_FAIL_BASE)
}


type NinaReportedLastPayload = { running: boolean; at: string }
type NinaStoppedPendingFailPayload = { at: string }

type GlobalWithNinaFail = typeof globalThis & {
  __pomfret_nina_reported_last__?: Record<string, NinaReportedLastPayload>
  __pomfret_nina_stopped_pending_fail__?: Record<string, NinaStoppedPendingFailPayload>
}

function ninaFailMemory(): {
  reported: Record<string, NinaReportedLastPayload>
  pending: Record<string, NinaStoppedPendingFailPayload>
} {
  const g = globalThis as GlobalWithNinaFail
  if (!g.__pomfret_nina_reported_last__) g.__pomfret_nina_reported_last__ = {}
  if (!g.__pomfret_nina_stopped_pending_fail__) g.__pomfret_nina_stopped_pending_fail__ = {}
  return { reported: g.__pomfret_nina_reported_last__, pending: g.__pomfret_nina_stopped_pending_fail__ }
}

async function readNinaReportedLast(): Promise<NinaReportedLastPayload | null> {
  if (kvEnabled()) {
    const remote = await kvGetJson<NinaReportedLastPayload>(ninaReportedLastKey())
    if (remote && typeof remote.running === 'boolean' && typeof remote.at === 'string') return remote
  }
  return ninaFailMemory().reported[currentObservatorySiteId()] ?? null
}

async function writeNinaReportedLast(running: boolean, atIso: string): Promise<void> {
  const payload: NinaReportedLastPayload = { running, at: atIso }
  if (kvEnabled()) {
    const ok = await kvSetJson(ninaReportedLastKey(), payload)
    if (ok) return
  }
  ninaFailMemory().reported[currentObservatorySiteId()] = payload
}

async function readNinaStoppedPendingFail(): Promise<NinaStoppedPendingFailPayload | null> {
  if (kvEnabled()) {
    const remote = await kvGetJson<NinaStoppedPendingFailPayload>(ninaStoppedPendingFailKey())
    if (remote && typeof remote.at === 'string') return remote
  }
  return ninaFailMemory().pending[currentObservatorySiteId()] ?? null
}

async function writeNinaStoppedPendingFail(atIso: string): Promise<void> {
  const payload: NinaStoppedPendingFailPayload = { at: atIso }
  if (kvEnabled()) {
    const ok = await kvSetJson(ninaStoppedPendingFailKey(), payload)
    if (ok) return
  }
  ninaFailMemory().pending[currentObservatorySiteId()] = payload
}

/** Session Completed arrived or NINA relaunched — cancel a pending NINA-stopped failure. */
export async function clearNinaStoppedPendingFail(): Promise<void> {
  if (kvEnabled()) {
    await kvDel(ninaStoppedPendingFailKey())
  }
  delete ninaFailMemory().pending[currentObservatorySiteId()]
}

export async function hasInProgressImagingSessions(): Promise<boolean> {
  for (const project of await listProjects()) {
    if (project.nights.some((n) => n.status === 'in_progress')) return true
  }
  const skipIds = await inactiveProjectBoardSkipIds()
  for (const entry of await listBoardEntries()) {
    if (entry.status === 'in_progress' && !skipIds.has(entry.id)) return true
  }
  return false
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

/** Same rule as leaving busy without completion, applied per project sub-session id. */
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
  if (failed.length > 0) {
    try {
      await lockObservatoryAfterSessionFailure(reason)
    } catch (error) {
      void appendAuditLog({
        kind: 'queue.status',
        message: `Session failure (${reason}): observatory lock threw.`,
        detail: { reason, error: error instanceof Error ? error.message : String(error) },
      })
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
  if (failed.length > 0) {
    try {
      await lockObservatoryAfterSessionFailure(reason)
    } catch (error) {
      void appendAuditLog({
        kind: 'queue.status',
        message: `Session failure (${reason}): observatory lock threw.`,
        detail: { reason, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }
  return failed.map((s) => s.id)
}

/**
 * Agent pulse reported NINA.exe stopped (explicit false after a prior true).
 * Does not fail immediately — waits for {@link NINA_STOPPED_FAIL_GRACE_MS} so Session Completed can land first.
 */
export async function onNinaRunningReported(ninaRunning: boolean, nowMs = Date.now()): Promise<void> {
  const atIso = new Date(nowMs).toISOString()
  const previous = await readNinaReportedLast()
  await writeNinaReportedLast(ninaRunning, atIso)

  if (ninaRunning) {
    await clearNinaStoppedPendingFail()
    return
  }

  if (previous?.running !== true) return

  if (!(await hasInProgressImagingSessions())) return

  await writeNinaStoppedPendingFail(atIso)
  await maybeFailSessionsAfterNinaStopped(nowMs)
}

/**
 * Apply pending failure once grace elapsed and NINA has not relaunched.
 * Safe to call from status reads, agent pulse, and session-progress POSTs.
 */
export async function maybeFailSessionsAfterNinaStopped(nowMs = Date.now()): Promise<void> {
  const pending = await readNinaStoppedPendingFail()
  if (!pending) return

  const pendingMs = Date.parse(pending.at)
  if (!Number.isFinite(pendingMs) || nowMs - pendingMs < NINA_STOPPED_FAIL_GRACE_MS) return

  const last = await readNinaReportedLast()
  if (last?.running === true) {
    await clearNinaStoppedPendingFail()
    return
  }

  if (!(await hasInProgressImagingSessions())) {
    await clearNinaStoppedPendingFail()
    return
  }

  await failInProgressProjectSubSessions(NINA_STOPPED_WITHOUT_COMPLETION_REASON)
  await failInProgressBoardSessions(undefined, NINA_STOPPED_WITHOUT_COMPLETION_REASON)
  await clearNinaStoppedPendingFail()
}
