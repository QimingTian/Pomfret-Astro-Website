import { NextRequest } from 'next/server'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { cronAuthorized } from '@/lib/cron-auth'
import {
  runImagingRetentionCleanup,
  runImagingScheduleMaintenance,
} from '@/lib/imaging-session-maintenance'
import { OBSERVATORY_SITES, resolveObservatorySite } from '@/lib/observatory-sites'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Vercel Cron: maintenance + purge completed sessions older than 48 hours. */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  const explicitSite =
    new URL(request.url).searchParams.get('site') ?? request.headers.get('x-observatory-site')

  /*
   * Without an explicit site, sweep every observatory rather than falling back
   * to Pomfret: a cron that quietly cleaned one site would leave every other
   * site's completed sessions on the board indefinitely.
   */
  const sites = explicitSite ? [resolveObservatorySite(explicitSite)] : OBSERVATORY_SITES

  const perSite: Array<{ siteId: string; purged: number; ids: string[] }> = []
  for (const site of sites) {
    const ids = await withObservatorySiteAsync(site.id, async () => {
      await runImagingScheduleMaintenance()
      return runImagingRetentionCleanup('cron_retention_48h')
    })
    perSite.push({ siteId: site.id, purged: ids.length, ids })
  }

  return withImagingCors({
    ok: true as const,
    purged: perSite.reduce((total, row) => total + row.purged, 0),
    ids: perSite.flatMap((row) => row.ids),
    sites: perSite,
  })
}
