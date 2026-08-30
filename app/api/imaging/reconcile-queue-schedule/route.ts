import { NextRequest } from 'next/server'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { cronAuthorized } from '@/lib/cron-auth'
import { runImagingScheduleMaintenance } from '@/lib/imaging-session-maintenance'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Agent or cron: refresh pending schedule from weather and queue rules.
 */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }
  await runImagingScheduleMaintenance()
  return withImagingCors({ ok: true as const, reconciled: true })
  })
}
