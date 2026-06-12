import { NextResponse } from 'next/server'
import {
  GEOCOLOR_FRAME_LIMIT,
  NOAA_GOES_GEOCOLOR_INDEX_URL,
  geocolorFramePaths,
  parseGeocolorFrameFilenames,
} from '@/lib/content/noaa-goes'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const response = await fetch(NOAA_GOES_GEOCOLOR_INDEX_URL, {
      headers: { 'User-Agent': 'Borean Astro/1.0 (Web)' },
      cache: 'no-store',
      redirect: 'error',
    })
    if (!response.ok) {
      return NextResponse.json({ error: `Failed to list frames: ${response.status}` }, { status: response.status })
    }
    const html = await response.text()
    const filenames = parseGeocolorFrameFilenames(html)
    const paths = geocolorFramePaths(filenames, GEOCOLOR_FRAME_LIMIT)
    if (paths.length === 0) {
      return NextResponse.json({ error: 'No GeoColor frames found' }, { status: 502 })
    }
    return NextResponse.json(
      { frames: paths.map((path) => ({ path })) },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
