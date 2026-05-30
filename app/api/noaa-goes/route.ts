import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOST = 'cdn.star.nesdis.noaa.gov'
const DEFAULT_GOES_PATH = '/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif'

function resolveNoaaGoesUrl(raw: string | null): string | null {
  const fallback = `https://${ALLOWED_HOST}${DEFAULT_GOES_PATH}`
  if (!raw?.trim()) return fallback

  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname.toLowerCase() !== ALLOWED_HOST) return null
  if (!parsed.pathname.startsWith('/GOES')) return null
  return parsed.toString()
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const url = resolveNoaaGoesUrl(searchParams.get('url'))

  if (!url) {
    return NextResponse.json({ error: 'Invalid or disallowed NOAA GOES URL' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Pomfret Observatory/1.0 (Web)',
      },
      cache: 'no-store',
      redirect: 'error',
    })

    if (!response.ok) {
      console.error(`NOAA GOES API: Failed to fetch image: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: response.status }
      )
    }

    const imageBuffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'image/jpeg'

    if (imageBuffer.byteLength === 0) {
      console.error('NOAA GOES API: Empty image buffer')
      return NextResponse.json({ error: 'Empty image data' }, { status: 500 })
    }

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    console.error('NOAA GOES API: Error fetching image:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
