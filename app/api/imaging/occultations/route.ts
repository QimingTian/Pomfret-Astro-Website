import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { loadOccultationEvents } from '@/lib/occultation/linea'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: Request) {
  return runWithRequestSite(request, async (site) => {
    try {
      const events = await loadOccultationEvents(site)
      return withImagingCors({
        ok: true as const,
        siteId: site.id,
        total: events.length,
        events,
        credit: 'LIneA Occultation Prediction Database',
        creditUrl: 'https://solarsystem.linea.org.br/docs/user-guide/api/',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load occultations'
      return withImagingCors({ ok: false as const, error: msg }, 502)
    }
  })
}
