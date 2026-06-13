import { NextRequest } from 'next/server'
import { personalIsEmergencyStopBlocking } from '@/lib/cloud/personal-emergency-stop'
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
  if (await personalIsEmergencyStopBlocking(tenantId)) {
    return personalJson(
      { error: 'Emergency STOP active; no imaging sequences are available.' },
      409
    )
  }
  return personalJson(
    {
      ok: false,
      error:
        'No scheduled pending session available for download. Submit a session from Control Client and wait for scheduling.',
    },
    409
  )
}
