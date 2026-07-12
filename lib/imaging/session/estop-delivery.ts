import { NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { imagingCorsHeadersResolved } from '@/lib/imaging-queue-auth'
import {
  getEmergencyStopState,
  isEmergencyStopStopping,
  markEmergencyStopDelivered,
  clearStaleUndeliveredEmergencyStop,
  isStaleUndeliveredEmergencyStop,
  emergencyStopAuditDetailFromState,
  emergencyStopTriggeredBySuffix,
} from '@/lib/imaging-emergency-stop'
import { estopSequenceJson } from '@/lib/imaging/session/estop-sequence'

/** Highest-priority delivery: Emergency STOP bypasses all gates while armed. */
export async function tryDeliverEmergencyStop(): Promise<NextResponse | null> {
  if (!(await isEmergencyStopStopping())) return null
  const state = await getEmergencyStopState()
  if (!state) return null
  if (state.deliveredAt) return null

  if (isStaleUndeliveredEmergencyStop(state)) {
    const cleared = await clearStaleUndeliveredEmergencyStop(state)
    if (cleared) {
      void appendAuditLog({
        kind: 'emergency_stop',
        message: `Cleared stale undelivered ESTOP state (${state.queueId}); skipped agent delivery.`,
        detail: emergencyStopAuditDetailFromState({
          ...state,
          event: 'stale_cleared',
          source: 'nina_agent_poll',
        }),
      })
    }
    return null
  }

  const marked = await markEmergencyStopDelivered(state.queueId)
  if (!marked) return null

  const payload = estopSequenceJson(state.queueId, {
    requestedByUserId: state.requestedByUserId,
    requestedByUsername: state.requestedByUsername,
  })
  void appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP sequence delivered to NINA agent (${state.queueId})${emergencyStopTriggeredBySuffix(state)}.`,
    detail: emergencyStopAuditDetailFromState({
      ...state,
      event: 'delivered',
      source: 'nina_agent_poll',
      armAgeSeconds: Math.max(
        0,
        Math.round((Date.now() - Date.parse(state.requestedAt)) / 1000)
      ),
    }),
  })

  return new NextResponse(payload, {
    status: 200,
    headers: {
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
