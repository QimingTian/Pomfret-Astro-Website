import { isAdminUser } from '@/lib/member-store'
import { getCurrentUser } from '@/lib/member-auth'
import { getEmergencyStopPublicState } from '@/lib/imaging-emergency-stop'
import { computeSiteImagingActive } from '@/lib/imaging/site-imaging-active'
import { listBoardEntries } from '@/lib/imaging-session-board'
import { listAll } from '@/lib/imaging-queue-store'
import { listProjects } from '@/lib/imaging/project/store'
import {
  getObservatoryMode,
  getObservatoryStatus,
  isObservatoryAgentConnected,
  isNinaReportedRunningNow,
} from '@/lib/observatory-status-store'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sessionsTick(queue: Awaited<ReturnType<typeof listAll>>, boardLength: number): string {
  let maxUpdated = 0
  for (const row of queue) {
    const t = Date.parse(row.updatedAt)
    if (Number.isFinite(t)) maxUpdated = Math.max(maxUpdated, t)
  }
  return `${queue.length}:${boardLength}:${maxUpdated}`
}

/** Lightweight poll replacement for long-lived site-stream SSE (saves Vercel Fluid hours). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  const isAdmin = isAdminUser(user)
  const [mode, status, queue, board, projects, ninaRunning] = await Promise.all([
    getObservatoryMode(),
    getObservatoryStatus({ skipLivePush: true }),
    listAll(),
    listBoardEntries(),
    listProjects(),
    isNinaReportedRunningNow(),
  ])
  const imagingActive = computeSiteImagingActive({
    queueRows: queue,
    boardRows: board,
    projects,
    ninaRunning,
  })

  const body: Record<string, unknown> = {
    ok: true,
    imagingActive,
    observatory: { type: 'observatory_status', mode, status },
    sessionsTick: sessionsTick(queue, board.length),
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
