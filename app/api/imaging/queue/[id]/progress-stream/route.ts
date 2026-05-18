import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import { listSessionProgressLinesFromAudit } from '@/lib/imaging-audit-log'
import { subscribeProgress, type LiveProgressEvent } from '@/lib/imaging-progress-live'
import { resolveImagingSessionContext, validateSessionPassword } from '@/lib/imaging-session-access'

export const runtime = 'nodejs'

const AUDIT_POLL_MS = 2000

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function linesFingerprint(lines: Array<{ at: string; text: string }>): string {
  return lines.map((l) => `${l.at}\t${l.text}`).join('\n')
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing id' }), { status: 400 })
  }

  const requestUrl = new URL(request.url)
  const providedPassword =
    request.headers.get('x-session-password') ??
    request.headers.get('x-admin-password') ??
    requestUrl.searchParams.get('password')
  const isAdmin = isImagingAdminPassword(providedPassword)
  if (!isAdmin) {
    const auth = await validateSessionPassword(id, providedPassword)
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status })
    }
  }

  const session = await resolveImagingSessionContext(id)
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const enqueue = (payload: unknown) => controller.enqueue(encoder.encode(sseData(payload)))

      let queueStatus = session.queueStatus
      let lines = await listSessionProgressLinesFromAudit(id)
      let fingerprint = linesFingerprint(lines)
      enqueue({ type: 'snapshot', queueStatus, lines })

      const unsubscribe = subscribeProgress(id, (event: LiveProgressEvent) => {
        if (event.type === 'status') {
          queueStatus = event.queueStatus
          enqueue(event)
          return
        }
        if (event.type === 'line') {
          lines = [...lines, { at: event.at, text: event.text }]
          fingerprint = linesFingerprint(lines)
          enqueue(event)
        }
      })

      const pollAudit = setInterval(async () => {
        try {
          const fresh = await listSessionProgressLinesFromAudit(id)
          const nextFp = linesFingerprint(fresh)
          if (nextFp === fingerprint) return
          fingerprint = nextFp
          lines = fresh
          const ctx = await resolveImagingSessionContext(id)
          if (ctx) queueStatus = ctx.queueStatus
          enqueue({ type: 'snapshot', queueStatus, lines: fresh })
        } catch {
          // ignore poll errors
        }
      }, AUDIT_POLL_MS)

      const keepAlive = setInterval(() => {
        enqueue({ type: 'ping' })
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        clearInterval(pollAudit)
        unsubscribe()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
