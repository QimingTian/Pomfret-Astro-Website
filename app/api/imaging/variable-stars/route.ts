import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { loadVariableStarCatalog } from '@/lib/variable-star-catalog'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: Request) {
  return runWithRequestSite(request, async (site) => {
    try {
      const stars = await loadVariableStarCatalog(site.id)
      return withImagingCors({ ok: true as const, total: stars.length, stars, siteId: site.id })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load catalog'
      return withImagingCors({ ok: false as const, error: msg }, 500)
    }
  })
}
