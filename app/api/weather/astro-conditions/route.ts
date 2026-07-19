import { NextResponse } from 'next/server'
import { fetchAstroConditions } from '@/lib/astro-conditions'

export const runtime = 'nodejs'

/** ASC overlay Transparency / Seeing from 7Timer ASTRO (server proxy; avoids mixed CSP/CORS). */
export async function GET() {
  try {
    const conditions = await fetchAstroConditions()
    if (conditions.transparency == null && conditions.seeing == null) {
      return NextResponse.json({ error: 'Astro conditions unavailable' }, { status: 502 })
    }
    return NextResponse.json(conditions)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Astro conditions fetch failed' },
      { status: 502 }
    )
  }
}
