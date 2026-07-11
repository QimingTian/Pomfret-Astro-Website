import { NextRequest, NextResponse } from 'next/server'
import { isAllowedLibrewxrTilePath, librewxrApiBaseUrl } from '@/lib/librewxr'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const segments = (await context.params).path
  if (!segments?.length) {
    return NextResponse.json({ error: 'Missing tile path' }, { status: 400 })
  }

  const tilePath = `/${segments.join('/')}`
  if (!isAllowedLibrewxrTilePath(tilePath)) {
    return NextResponse.json({ error: 'Disallowed tile path' }, { status: 400 })
  }

  const upstream = `${librewxrApiBaseUrl()}${tilePath}`

  try {
    const res = await fetch(upstream, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Pomfret Observatory/1.0 (Web)' },
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Tile HTTP ${res.status}` }, { status: res.status })
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: 'Empty tile' }, { status: 502 })
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=120',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Tile fetch failed' },
      { status: 502 }
    )
  }
}
