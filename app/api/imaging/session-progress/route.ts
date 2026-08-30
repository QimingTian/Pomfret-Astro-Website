import { NextRequest } from 'next/server'
import { logMissingProductionSecret, observatorySecretConfigured } from '@/lib/production-secrets'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendCompletionEmail } from '@/lib/imaging-completion-email'
import { notifyProjectNightCompletionEmail } from '@/lib/imaging-project-night-email'
import { publishProgress } from '@/lib/imaging-progress-live'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { logEndNightDue } from '@/lib/imaging-end-night-audit'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { hasRemainingTonightImagingWork } from '@/lib/imaging-tonight-complete'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import {
  getProjectByNightSubId,
  markNightCompleted,
} from '@/lib/imaging-project-store'
import { boardMarkCompleted, getBoardEntry } from '@/lib/imaging-session-board'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { resolveSessionProgressQueueId } from '@/lib/imaging-session-progress-queue'
import {
  getEmergencyStopState,
  isEmergencyStopQueueId,
  markEmergencyStopCompleted,
  emergencyStopAuditDetailFromState,
  emergencyStopTriggeredBySuffix,
} from '@/lib/imaging-emergency-stop'
import {
  clearNinaStoppedPendingFail,
  maybeFailSessionsAfterNinaStopped,
} from '@/lib/imaging-session-failure'
import { lockObservatoryForEmergencyStop } from '@/lib/imaging/session/failure-observatory-lock'
import { isSessionCompletedSignal, progressLineText } from '@/lib/session-progress-signal'

export const runtime = 'nodejs'

async function markEndNightDueIfTonightComplete(): Promise<void> {
  const now = new Date()
  const schedulingWindow = getTonightSchedulingWindow(now)
  const nightKey = getTonightScheduleStrip(now).nightKey
  // Reconcile first so the next pending project can get tonight subs before we
  // decide the night is empty (otherwise end-night arms on a race and skips the queue).
  await reconcilePendingScheduleStatus({ force: true })
  const remaining = await hasRemainingTonightImagingWork(
    nightKey,
    schedulingWindow.nauticalDuskUtc.getTime(),
    schedulingWindow.nauticalDawnUtc.getTime()
  )
  if (remaining) {
    const { clearEndNightDue } = await import('@/lib/end-night-state')
    await clearEndNightDue(nightKey)
    return
  }
  await logEndNightDue(nightKey, 'tonight imaging complete (NINA session end signal)')
}

/** When set, requests must authenticate (see `authorized`). When unset, endpoint is open (use only if you accept that risk). */
function authPassword(): string | undefined {
  const p = process.env.NINA_SESSION_PROGRESS_BASIC_PASSWORD
  return p && p.length > 0 ? p : undefined
}

function expectedBasicUser(): string {
  return process.env.NINA_SESSION_PROGRESS_BASIC_USER ?? ''
}

function parseBasicCredentials(authorization: string | null): { user: string; pass: string } | null {
  if (!authorization?.startsWith('Basic ')) return null
  try {
    const raw = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
    const colon = raw.indexOf(':')
    if (colon === -1) return { user: '', pass: raw }
    return { user: raw.slice(0, colon), pass: raw.slice(colon + 1) }
  } catch {
    return null
  }
}

function authorized(request: NextRequest): boolean {
  const expectedPass = authPassword()
  if (!expectedPass) {
    if (!observatorySecretConfigured(expectedPass)) {
      logMissingProductionSecret('NINA_SESSION_PROGRESS_BASIC_PASSWORD')
      return false
    }
    return true
  }

  const expectedUser = expectedBasicUser()
  const basic = parseBasicCredentials(request.headers.get('authorization'))
  if (basic && basic.pass === expectedPass) {
    // NINA Ground Station sends HttpAuthUsername (e.g. pomfretastro). When
    // NINA_SESSION_PROGRESS_BASIC_USER is unset, accept any username with the right password.
    if (!expectedUser || basic.user === expectedUser) return true
  }

  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${expectedPass}`) return true

  return request.headers.get('x-nina-session-progress-secret') === expectedPass
}

async function readBody(request: NextRequest): Promise<unknown> {
  const raw = await request.text()
  const trimmed = raw.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return { text: raw }
    }
  }
  return { text: raw }
}

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * NINA Ground Station → HTTP POST.
 *
 * Auth (optional): set `NINA_SESSION_PROGRESS_BASIC_PASSWORD` on the server.
 * Then use NINA "HTTP Authentication" with the same username/password, or send
 * `Authorization: Bearer <password>` / header `x-nina-session-progress-secret: <password>`.
 * Optional user: `NINA_SESSION_PROGRESS_BASIC_USER` (default empty string).
 *
 * Body: JSON or text/plain (stored under `detail.text` when not JSON).
 */
export async function POST(request: NextRequest) {
  return runWithRequestSite(request, async () => {
  if (!authorized(request)) {
    const basic = parseBasicCredentials(request.headers.get('authorization'))
    void appendAuditLog({
      kind: 'session.progress',
      message: 'Rejected unauthorized session-progress POST (check NINA HTTP auth vs Vercel env).',
      detail: {
        hasAuthorization: Boolean(request.headers.get('authorization')),
        basicUser: basic?.user ?? null,
        expectedUserSet: expectedBasicUser().length > 0,
      },
    })
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  const body = await readBody(request)

  const detail =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { payload: body }

  const completionSignal = isSessionCompletedSignal(detail)

  const queueId = await resolveSessionProgressQueueId(detail)

  const auditDetail = queueId
    ? {
        ...detail,
        queueId,
        ...(parseProjectNightSubId(queueId) ? { subSessionId: queueId } : {}),
      }
    : detail
  const msg =
    typeof detail.message === 'string'
      ? detail.message
      : typeof detail.step === 'string'
        ? `Step: ${detail.step}`
        : typeof detail.text === 'string'
          ? (detail.text.split(/\r?\n/).find((l) => l.trim()) ?? detail.text).trim().slice(0, 240) ||
            'Session progress update'
          : 'Session progress update'

  const at = new Date().toISOString()
  // Routine NINA progress goes to per-session progress lists (not the audit monolith).
  // Audit remains for completion / ESTOP / failures below.
  if (queueId) {
    publishProgress(queueId, {
      type: 'line',
      at,
      text: progressLineText(auditDetail),
    })
  } else {
    void appendAuditLog({
      kind: 'session.progress',
      message: msg,
      detail: auditDetail,
      at,
    })
  }

  if (queueId && isEmergencyStopQueueId(queueId)) {
    const line = progressLineText(auditDetail).toLowerCase()
    if (line.includes('dome closed')) {
      const estopState = await getEmergencyStopState()
      const persisted = await markEmergencyStopCompleted(queueId)
      await lockObservatoryForEmergencyStop('session_progress_dome_closed')
      void appendAuditLog({
        kind: 'emergency_stop',
        message: persisted
          ? `Emergency STOP completed (${queueId})${emergencyStopTriggeredBySuffix(estopState ?? {})}; observatory locked to manual Closed — Maintenance.`
          : `Emergency STOP completion signal received (${queueId}) but STOPPED state failed to persist to KV.`,
        detail: emergencyStopAuditDetailFromState({
          queueId,
          requestedAt: estopState?.requestedAt,
          requestedBy: estopState?.requestedBy,
          requestedByUserId: estopState?.requestedByUserId,
          requestedByUsername: estopState?.requestedByUsername,
          requestedByEmail: estopState?.requestedByEmail,
          event: persisted ? 'completed' : 'complete_persist_failed',
          source: 'session_progress',
        }),
      })
    }
  }

  if (queueId && completionSignal) {
    await clearNinaStoppedPendingFail()
    const nightSub = parseProjectNightSubId(queueId)
    if (nightSub) {
      const match = await getProjectByNightSubId(queueId)
      if (match && match.night.status === 'in_progress') {
        const result = await markNightCompleted(match.project.id, queueId)
        if (result) {
          const completedAtIso = new Date().toISOString()
          publishProgress(queueId, { type: 'status', queueStatus: 'completed' })
          void appendAuditLog({
            kind: 'queue.status',
            message: `Project sub-session ${queueId} completed (end signal from NINA).`,
            detail: { id: queueId, projectId: match.project.id, target: match.project.target },
          })
          notifyProjectNightCompletionEmail(
            {
              queueId,
              target: match.project.target,
              email: match.project.email,
              firstName: match.project.firstName,
            },
            completedAtIso
          )
          if (result.projectCompleted) {
            const board = await getBoardEntry(match.project.id)
            if (board?.status === 'in_progress') {
              await boardMarkCompleted(match.project.id)
            }
            publishProgress(match.project.id, { type: 'status', queueStatus: 'completed' })
          }
          // Must finish reconcile + end-night decision before responding so the next
          // project is scheduled (or end-night correctly armed) before NINA's next poll.
          await markEndNightDueIfTonightComplete()
        }
      }
      return withImagingCors({ ok: true as const })
    }

    const board = await getBoardEntry(queueId)
    if (board?.status === 'in_progress') {
      const ok = await boardMarkCompleted(queueId)
      if (ok) {
        void appendAuditLog({
          kind: 'queue.status',
          message: `Session ${queueId} completed (end signal from NINA).`,
          detail: { id: queueId, target: board.target },
        })
        void sendCompletionEmail({
          queueId,
          target: board.target,
          email: board.email,
          firstName: board.firstName,
          completedAtIso: new Date().toISOString(),
        }).then((result) => {
          if (!result.sent) {
            return appendAuditLog({
              kind: 'session.progress',
              message: `Completion email skipped/failed for ${queueId}: ${result.reason ?? 'unknown reason'}`,
              detail: { queueId, reason: result.reason ?? null },
            })
          }
          return appendAuditLog({
            kind: 'session.progress',
            message: `Completion email sent for ${queueId}.`,
            detail: { queueId, email: board.email ?? null },
          })
        })
        publishProgress(queueId, { type: 'status', queueStatus: 'completed' })
        await markEndNightDueIfTonightComplete()
      }
    }
  }

  try {
    await maybeFailSessionsAfterNinaStopped()
  } catch {
    // never block progress POST
  }

  return withImagingCors({ ok: true as const })
  })
}
