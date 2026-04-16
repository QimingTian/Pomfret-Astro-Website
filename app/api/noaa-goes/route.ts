import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Pomfret Observatory/1.0 (Web)',
      },
      cache: 'no-store',
      redirect: 'follow',
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
      return NextResponse.json(
        { error: 'Empty image data' },
        { status: 500 }
      )
    }

    console.log(`NOAA GOES API: Successfully fetched image, size: ${imageBuffer.byteLength} bytes, type: ${contentType}`)

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=600', // Cache for 10 minutes
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

