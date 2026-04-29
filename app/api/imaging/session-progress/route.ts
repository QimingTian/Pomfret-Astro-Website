import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { publishProgress } from '@/lib/imaging-progress-live'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { boardMarkCompleted, getBoardEntry, getSoleInProgressBoardId } from '@/lib/imaging-session-board'
import { isSessionCompletedSignal, progressLineText, readQueueIdFromDetail } from '@/lib/session-progress-signal'

export const runtime = 'nodejs'

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
  if (!expectedPass) return true

  const basic = parseBasicCredentials(request.headers.get('authorization'))
  if (basic && basic.user === expectedBasicUser() && basic.pass === expectedPass) return true

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
  if (!authorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  const body = await readBody(request)

  const detail =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { payload: body }

  let queueId = readQueueIdFromDetail(detail)
  if (!queueId) {
    queueId = await getSoleInProgressBoardId()
  }

  const auditDetail = queueId ? { ...detail, queueId } : detail
  const msg =
    typeof detail.message === 'string'
      ? detail.message
      : typeof detail.step === 'string'
        ? `Step: ${detail.step}`
        : typeof detail.text === 'string'
          ? (detail.text.split(/\r?\n/).find((l) => l.trim()) ?? detail.text).trim().slice(0, 240) ||
            'Session progress update'
          : 'Session progress update'

  // Same durable store as Admin (`imaging-audit-log`); Admin UI hides `session.progress` rows.
  await appendAuditLog({
    kind: 'session.progress',
    message: msg,
    detail: auditDetail,
  })
  if (queueId) {
    publishProgress(queueId, {
      type: 'line',
      at: new Date().toISOString(),
      text: progressLineText(auditDetail),
    })
  }

  if (queueId && isSessionCompletedSignal(detail)) {
    const board = await getBoardEntry(queueId)
    if (board?.status === 'in_progress') {
      const ok = await boardMarkCompleted(queueId)
      if (ok) {
        void appendAuditLog({
          kind: 'queue.status',
          message: `Session ${queueId} completed (end signal from NINA).`,
          detail: { id: queueId, target: board.target },
        })
        publishProgress(queueId, { type: 'status', queueStatus: 'completed' })
      }
    }
  }

  return withImagingCors({ ok: true as const })
}
