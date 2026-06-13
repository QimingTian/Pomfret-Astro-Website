import { NextRequest } from 'next/server'
import {
  personalArmEmergencyStop,
  personalGetEmergencyStopPublicState,
  isPersonalAgentConnected,
} from '@/lib/cloud/personal-emergency-stop'
import { emitAgentWakePollSequence } from '@/lib/imaging/live-bus'
import { personalJson, personalOptions, requirePersonalTenant } from '@/lib/cloud/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const publicState = await personalGetEmergencyStopPublicState(tenantId)
  return personalJson({ ok: true as const, ...publicState })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied

  const agentConnected = await isPersonalAgentConnected(tenantId)
  if (!agentConnected) {
    return personalJson(
      { ok: false as const, error: 'NINA agent is disconnected. ESTOP is unavailable.' },
      409
    )
  }

  try {
    await personalArmEmergencyStop(tenantId, 'control-client')
  } catch (ex) {
    const message = ex instanceof Error ? ex.message : 'Emergency STOP failed.'
    return personalJson({ ok: false as const, error: message }, 409)
  }

  void emitAgentWakePollSequence(tenantId)
  const publicState = await personalGetEmergencyStopPublicState(tenantId)
  return personalJson({ ok: true as const, ...publicState })
}
