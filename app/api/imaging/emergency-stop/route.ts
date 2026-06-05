import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  armEmergencyStop,
  getEmergencyStopPublicState,
  isEmergencyStopBlocking,
  updateEmergencyStopHeldSessionIds,
} from '@/lib/imaging-emergency-stop'
import { applyEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import { requireImagingAdmin } from '@/lib/imaging-admin-auth'
import {
  failInProgressBoardSessions,
  failInProgressProjectSubSessions,
} from '@/lib/imaging-session-failure'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { isObservatoryAgentConnected } from '@/lib/observatory-status-store'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const admin = await requireImagingAdmin(request)
  if (!admin.ok) {
    return withImagingCors({ ok: false as const, error: admin.error }, admin.status)
  }

  const agentConnected = await isObservatoryAgentConnected()
  const publicState = await getEmergencyStopPublicState(agentConnected)
  return withImagingCors({
    ok: true as const,
    agentConnected,
    ...publicState,
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireImagingAdmin(request)
  if (!admin.ok) {
    return withImagingCors({ ok: false as const, error: admin.error }, admin.status)
  }

  const agentConnected = await isObservatoryAgentConnected()
  if (!agentConnected) {
    return withImagingCors(
      { ok: false as const, error: 'NINA agent is disconnected. ESTOP is unavailable.' },
      409
    )
  }

  if (await isEmergencyStopBlocking()) {
    return withImagingCors(
      { ok: false as const, error: 'Emergency STOP is already active.' },
      409
    )
  }

  const heldSessionIds = await applyEmergencyStopHolds()
  const state = await armEmergencyStop(admin.user.username, heldSessionIds)
  if (heldSessionIds.length !== state.heldSessionIds.length) {
    await updateEmergencyStopHeldSessionIds(heldSessionIds)
  }

  const failedSubs = await failInProgressProjectSubSessions('emergency_stop')
  const failedBoard = await failInProgressBoardSessions(undefined, 'emergency_stop')

  await appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP armed (${state.queueId}). ${heldSessionIds.length} session(s) on hold; failed ${failedSubs.length + failedBoard.length} in-progress.`,
    detail: {
      queueId: state.queueId,
      requestedBy: admin.user.username,
      heldSessionIds,
      failedProjectSubSessions: failedSubs,
      failedBoardSessions: failedBoard,
    },
  })

  const publicState = await getEmergencyStopPublicState(agentConnected)
  return withImagingCors({
    ok: true as const,
    ...publicState,
    failedSessionIds: [...failedSubs, ...failedBoard],
  })
}
