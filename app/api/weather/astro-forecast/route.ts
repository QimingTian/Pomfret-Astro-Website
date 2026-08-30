import { NextRequest, NextResponse } from 'next/server'
import { fetchAstroForecast } from '@/lib/weather/astro-forecast'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

export const runtime = 'nodejs'

/** Tonight hourly forecast + 7Timer seeing/transparency for Weather dashboard (Cygnus / multi-site). */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
    const snapshot = await fetchAstroForecast()
    if (!snapshot.ok) {
      return NextResponse.json(snapshot, { status: 502 })
    }
    return NextResponse.json(snapshot)
  })
}
