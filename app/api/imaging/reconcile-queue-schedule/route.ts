import { NextRequest } from 'next/server'
import '@/lib/observatory-site-als'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { cronAuthorized } from '@/lib/cron-auth'
import { runImagingScheduleMaintenance } from '@/lib/imaging-session-maintenance'
import { observatorySiteFromRequest, OBSERVATORY_SITES } from '@/lib/observatory-sites'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Agent or cron: refresh pending schedule from weather and queue rules.
 * Without an explicit site, runs for every observatory (same as cleanup-sessions).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  const url = new URL(request.url)
  const explicitSite =
    url.searchParams.get('site')?.trim() ||
    request.headers.get('x-observatory-site')?.trim() ||
    ''

  const sites =
    explicitSite.length > 0
      ? [observatorySiteFromRequest(request)]
      : OBSERVATORY_SITES

  const perSite: Array<{ siteId: string; reconciled: true }> = []
  for (const site of sites) {
    await withObservatorySiteAsync(site.id, async () => {
      await runImagingScheduleMaintenance()
      perSite.push({ siteId: site.id, reconciled: true })
    })
  }

  return withImagingCors({ ok: true as const, reconciled: true, perSite })
}
