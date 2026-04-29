import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { isAltitudeAllowed } from '@/lib/target-altitude'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }

  const raHours = Number((body as { raHours?: unknown })?.raHours)
  const decDeg = Number((body as { decDeg?: unknown })?.decDeg)
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) {
    return withImagingCors({ ok: false as const, error: 'raHours and decDeg must be numbers' }, 400)
  }

  const check = isAltitudeAllowed(raHours, decDeg)
  return withImagingCors({
    ok: true as const,
    altitudeDeg: Number(check.altitudeDeg.toFixed(3)),
    minAltitudeDeg: check.minAltitudeDeg,
    visible: check.ok,
  })
}
