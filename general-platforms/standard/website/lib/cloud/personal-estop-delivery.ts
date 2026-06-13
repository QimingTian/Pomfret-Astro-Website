import { NextResponse } from 'next/server'
import { personalEstopSequenceJson } from '@/lib/cloud/personal-estop-sequence'
import {
  personalGetEmergencyStopState,
  personalIsEmergencyStopStopping,
  personalMarkEmergencyStopDelivered,
} from '@/lib/cloud/personal-emergency-stop'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function personalTryDeliverEmergencyStop(
  tenantId: string
): Promise<NextResponse | null> {
  if (!(await personalIsEmergencyStopStopping(tenantId))) return null
  const state = await personalGetEmergencyStopState(tenantId)
  if (!state || state.deliveredAt) return null

  const marked = await personalMarkEmergencyStopDelivered(tenantId, state.queueId)
  if (!marked) return null

  const payload = personalEstopSequenceJson(tenantId, state.queueId)
  return new NextResponse(payload, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function personalEstopDeliveryBlockingResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Emergency STOP active; no imaging sequences are available.' },
    { status: 409, headers: CORS_HEADERS }
  )
}
