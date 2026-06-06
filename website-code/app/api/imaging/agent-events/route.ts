import { subscribeLiveEvents } from '@/lib/imaging/live-bus'
import {
  imagingCorsHeadersResolved,
  imagingCorsOptions,
  imagingQueueAuthorized,
  imagingUnauthorized,
} from '@/lib/imaging-queue-auth'
import { touchObservatoryPoll } from '@/lib/observatory-status-store'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Observatory agent SSE: push estop / sequence / reconcile wake events. */
export async function GET(request: NextRequest) {
  if (!imagingQueueAuthorized(request)) {
    return imagingUnauthorized()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const enqueue = (payload: unknown) => controller.enqueue(encoder.encode(sseData(payload)))

      await touchObservatoryPoll()
      enqueue({ type: 'connected' })

      const unsubscribe = subscribeLiveEvents(
        'agent:wake',
        (payload) => {
          if (!payload || typeof payload !== 'object') return
          const wakeType = (payload as { type?: unknown }).type
          if (wakeType === 'estop' || wakeType === 'poll_sequence' || wakeType === 'reconcile') {
            enqueue({ type: wakeType })
          }
        },
        request.signal
      )

      const keepAlive = setInterval(() => {
        void touchObservatoryPoll()
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
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
