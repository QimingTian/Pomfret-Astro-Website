import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  armEmergencyStop,
  emergencyStopAuditDetail,
  emergencyStopTriggeredBySuffix,
  getEmergencyStopPublicState,
  getEmergencyStopState,
  updateEmergencyStopHeldSessionIds,
} from '@/lib/imaging-emergency-stop'
import { applyEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import { requireImagingAdmin, imagingAdminActorFromUser } from '@/lib/imaging-admin-auth'
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

  const previous = await getEmergencyStopState()
  const heldSessionIds = await applyEmergencyStopHolds()
  const actor = imagingAdminActorFromUser(admin.user)
  const state = await armEmergencyStop(actor, heldSessionIds)
  if (heldSessionIds.length !== state.heldSessionIds.length) {
    await updateEmergencyStopHeldSessionIds(heldSessionIds)
  }

  const failedSubs = await failInProgressProjectSubSessions('emergency_stop')
  const failedBoard = await failInProgressBoardSessions(undefined, 'emergency_stop')

  await appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP armed (${state.queueId})${emergencyStopTriggeredBySuffix(state)}. ${heldSessionIds.length} session(s) on hold; failed ${failedSubs.length + failedBoard.length} in-progress.`,
    detail: emergencyStopAuditDetail({
      queueId: state.queueId,
      requestedAt: state.requestedAt,
      requestedBy: state.requestedBy,
      requestedByUserId: state.requestedByUserId,
      requestedByUsername: state.requestedByUsername,
      requestedByEmail: state.requestedByEmail,
      event: 'armed',
      source: 'admin_dashboard_post',
      clientIp:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip')?.trim() ||
        null,
      userAgent: request.headers.get('user-agent') ?? null,
      ...(previous?.queueId && previous.queueId !== state.queueId
        ? { replacedQueueId: previous.queueId, replacedPhase: previous.phase }
        : {}),
      heldSessionIds,
      failedProjectSubSessions: failedSubs,
      failedBoardSessions: failedBoard,
    }),
  })

  const publicState = await getEmergencyStopPublicState(agentConnected)
  return withImagingCors({
    ok: true as const,
    ...publicState,
    failedSessionIds: [...failedSubs, ...failedBoard],
  })
}
