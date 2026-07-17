import { listSessionProgressLines } from '@/lib/imaging/core/session-progress-store'
import { liveProgressChannel, subscribeLiveEvents } from '@/lib/imaging/live-bus'
import { subscribeProgress, type LiveProgressEvent } from '@/lib/imaging-progress-live'
import { authorizeImagingSession, resolveImagingSessionContext } from '@/lib/imaging-session-access'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing id' }), { status: 400 })
  }

  const providedPassword = request.headers.get('x-session-password')?.trim() || null
  const auth = await authorizeImagingSession(request, id, providedPassword)
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status })
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
      const lines = await listSessionProgressLines(id)
      enqueue({ type: 'snapshot', queueStatus, lines })

      const onLiveEvent = (event: LiveProgressEvent) => {
        if (event.type === 'status') {
          queueStatus = event.queueStatus
          enqueue(event)
          return
        }
        if (event.type === 'line') {
          enqueue(event)
        }
      }

      const handleBusPayload = (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const event = payload as LiveProgressEvent
        if (event.type === 'line' || event.type === 'status') onLiveEvent(event)
      }

      const unsubscribeLocal = subscribeProgress(id, onLiveEvent)
      const unsubscribeBus = subscribeLiveEvents(liveProgressChannel(id), handleBusPayload, request.signal)

      const keepAlive = setInterval(() => {
        enqueue({ type: 'ping' })
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        unsubscribeLocal()
        unsubscribeBus()
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
