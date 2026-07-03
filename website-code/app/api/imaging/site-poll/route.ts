import { isAdminUser } from '@/lib/member-store'
import { getCurrentUser } from '@/lib/member-auth'
import { getEmergencyStopPublicState } from '@/lib/imaging-emergency-stop'
import {
  getObservatoryMode,
  getObservatoryStatus,
  isObservatoryAgentConnected,
} from '@/lib/observatory-status-store'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lightweight poll replacement for long-lived site-stream SSE (saves Vercel Fluid hours). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  const isAdmin = isAdminUser(user)
  const [mode, status] = await Promise.all([getObservatoryMode(), getObservatoryStatus({ skipLivePush: true })])

  const body: Record<string, unknown> = {
    ok: true,
    observatory: { type: 'observatory_status', mode, status },
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
