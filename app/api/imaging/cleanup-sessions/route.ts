import { NextRequest } from 'next/server'
import '@/lib/observatory-site-als'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { cronAuthorized } from '@/lib/cron-auth'
import {
  runImagingRetentionCleanup,
  runImagingScheduleMaintenance,
} from '@/lib/imaging-session-maintenance'
import { observatorySiteFromRequest, OBSERVATORY_SITES } from '@/lib/observatory-sites'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Vercel Cron: maintenance + purge completed sessions older than 48 hours (every site). */
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

  const perSite: Array<{ siteId: string; purged: number; ids: string[] }> = []
  for (const site of sites) {
    await withObservatorySiteAsync(site.id, async () => {
      await runImagingScheduleMaintenance()
      const ids = await runImagingRetentionCleanup('cron_retention_48h')
      perSite.push({ siteId: site.id, purged: ids.length, ids })
    })
  }

  const purgedIds = perSite.flatMap((s) => s.ids)
  return withImagingCors({
    ok: true as const,
    purged: purgedIds.length,
    ids: purgedIds,
    perSite,
  })
}
