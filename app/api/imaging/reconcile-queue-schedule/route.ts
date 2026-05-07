import { NextRequest } from 'next/server'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

function cronAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return true
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${expected}`
}

/**
 * Vercel Cron (or manual): refresh pending `scheduleStatus` / `plannedStartIso` from weather and queue rules
 * without anyone opening the Remote dashboard.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }
  await reconcilePendingScheduleStatus()
  return withImagingCors({ ok: true as const, reconciled: true })
}
