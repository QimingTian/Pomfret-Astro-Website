import { NextRequest } from 'next/server'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { cronAuthorized } from '@/lib/cron-auth'
import {
  runImagingRetentionCleanup,
  runImagingScheduleMaintenance,
} from '@/lib/imaging-session-maintenance'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Vercel Cron: maintenance + purge completed sessions older than 48 hours. */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  await runImagingScheduleMaintenance()
  const purgedIds = await runImagingRetentionCleanup('cron_retention_48h')

  return withImagingCors({
    ok: true as const,
    purged: purgedIds.length,
    ids: purgedIds,
  })
}
