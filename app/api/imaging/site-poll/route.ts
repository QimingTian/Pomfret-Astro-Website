import { isAdminUser } from '@/lib/member-store'
import { getCurrentUser } from '@/lib/member-auth'
import { getEmergencyStopPublicState } from '@/lib/imaging-emergency-stop'
import { getSitePollSnapshot } from '@/lib/imaging/site-poll-snapshot'
import {
  getObservatoryMode,
  getObservatoryStatus,
  isObservatoryAgentConnected,
} from '@/lib/observatory-status-store'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lightweight poll replacement for long-lived site-stream SSE (saves Vercel Fluid hours + KV bandwidth). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  const isAdmin = isAdminUser(user)
  const [mode, status, snapshot] = await Promise.all([
    getObservatoryMode(),
    getObservatoryStatus({ skipLivePush: true }),
    getSitePollSnapshot(),
  ])

  const body: Record<string, unknown> = {
    ok: true,
    imagingActive: snapshot.imagingActive,
    observatory: { type: 'observatory_status', mode, status },
    sessionsTick: snapshot.sessionsTick,
  }

  if (isAdmin) {
    const agentConnected = await isObservatoryAgentConnected()
    const estop = await getEmergencyStopPublicState(agentConnected)
    body.estop = { type: 'estop', agentConnected, ...estop }
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}
