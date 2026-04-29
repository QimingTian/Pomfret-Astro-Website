import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import { validateSessionPassword } from '@/lib/imaging-session-access'
import { subscribeProgress, type LiveProgressEvent } from '@/lib/imaging-progress-live'
import { listSessionProgressLinesFromAudit } from '@/lib/imaging-audit-log'
import { getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById } from '@/lib/imaging-queue-store'

export const runtime = 'nodejs'

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
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

  const req = await getRequestById(id)
  const board = await getBoardEntry(id)
  if (!req && !board) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const enqueue = (payload: unknown) => controller.enqueue(encoder.encode(sseData(payload)))

      const lines = await listSessionProgressLinesFromAudit(id)
      const queueStatus = req?.status ?? board?.status ?? 'pending'
      enqueue({ type: 'snapshot', queueStatus, lines })

      const unsubscribe = subscribeProgress(id, (event: LiveProgressEvent) => {
        enqueue(event)
      })

      const keepAlive = setInterval(() => {
        enqueue({ type: 'ping' })
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
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
