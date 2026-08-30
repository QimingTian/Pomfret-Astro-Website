import { NextRequest, NextResponse } from 'next/server'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

import {
  imagingCorsHeadersResolved,
  imagingCorsOptions,
  imagingQueueAuthorized,
  imagingUnauthorized,
} from '@/lib/imaging-queue-auth'
import { isEmergencyStopBlocking } from '@/lib/imaging-emergency-stop'
import { tryDeliverEmergencyStop } from '@/lib/imaging/session/estop-delivery'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Lightweight ESTOP delivery for the observatory agent.
 * Does not run scheduling logic — only checks and delivers an armed Emergency STOP sequence.
 */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
  if (!imagingQueueAuthorized(request)) {
    return imagingUnauthorized()
  }

  const emergencyDelivered = await tryDeliverEmergencyStop()
  if (emergencyDelivered) return emergencyDelivered

  if (await isEmergencyStopBlocking()) {
    return NextResponse.json(
      { error: 'Emergency STOP active; no imaging sequences are available.' },
      { status: 409, headers: imagingCorsHeadersResolved() }
    )
  }

  return new NextResponse(null, { status: 204, headers: imagingCorsHeadersResolved() })
  })
}
