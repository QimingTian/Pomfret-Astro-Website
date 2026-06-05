import { NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { imagingCorsHeadersResolved } from '@/lib/imaging-queue-auth'
import {
  getEmergencyStopState,
  isEmergencyStopStopping,
  markEmergencyStopDelivered,
} from '@/lib/imaging-emergency-stop'
import { estopSequenceJson } from '@/lib/imaging/session/estop-sequence'

/** Highest-priority delivery: Emergency STOP bypasses all gates while armed. */
export async function tryDeliverEmergencyStop(): Promise<NextResponse | null> {
  if (!(await isEmergencyStopStopping())) return null
  const state = await getEmergencyStopState()
  if (!state) return null
  if (state.deliveredAt) return null

  const payload = estopSequenceJson(state.queueId)
  await markEmergencyStopDelivered(state.queueId)
  void appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP sequence delivered to NINA agent (${state.queueId}).`,
    detail: { queueId: state.queueId, requestedAt: state.requestedAt },
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
