import { subscribeLiveEvents } from '@/lib/imaging/live-bus'
import { isAdminUser } from '@/lib/member-store'
import { getCurrentUser } from '@/lib/member-auth'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import {
  getEmergencyStopPublicState,
} from '@/lib/imaging-emergency-stop'
import {
  getObservatoryMode,
  getObservatoryStatus,
  isObservatoryAgentConnected,
} from '@/lib/observatory-status-store'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
  const user = await getCurrentUser(request)
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  const isAdmin = isAdminUser(user)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const enqueue = (payload: unknown) => controller.enqueue(encoder.encode(sseData(payload)))

      const [mode, status] = await Promise.all([getObservatoryMode(), getObservatoryStatus()])
      enqueue({ type: 'observatory_status', mode, status })

      if (isAdmin) {
        const agentConnected = await isObservatoryAgentConnected()
        const estop = await getEmergencyStopPublicState(agentConnected)
        enqueue({ type: 'estop', agentConnected, ...estop })
      }

      const channels = ['site:observatory', 'site:sessions'] as const
      const unsubscribes = channels.map((channel) =>
        subscribeLiveEvents(channel, (payload) => {
          if (!payload || typeof payload !== 'object') return
          enqueue(payload)
        }, request.signal)
      )

      if (isAdmin) {
        unsubscribes.push(
          subscribeLiveEvents('site:estop', (payload) => {
            if (!payload || typeof payload !== 'object') return
            enqueue(payload)
          }, request.signal)
        )
      }

      const keepAlive = setInterval(() => {
        enqueue({ type: 'ping' })
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        for (const unsub of unsubscribes) unsub()
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
  })
}
