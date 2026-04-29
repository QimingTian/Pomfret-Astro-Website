import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { loadVariableStarCatalog } from '@/lib/variable-star-catalog'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET() {
  try {
    const stars = await loadVariableStarCatalog()
    return withImagingCors({ ok: true as const, total: stars.length, stars })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load catalog'
    return withImagingCors({ ok: false as const, error: msg }, 500)
  }
}
