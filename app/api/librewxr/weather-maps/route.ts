import { NextResponse } from 'next/server'
import { librewxrApiBaseUrl, type LibrewxrWeatherMaps } from '@/lib/librewxr'

export const runtime = 'nodejs'

export async function GET() {
  const base = librewxrApiBaseUrl()
  try {
    const res = await fetch(`${base}/public/weather-maps.json`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Pomfret Observatory/1.0 (Web)' },
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `LibreWXR metadata HTTP ${res.status}` },
        { status: 502 }
      )
    }
    const data = (await res.json()) as LibrewxrWeatherMaps
    return NextResponse.json({
      ...data,
      host: base,
      proxied: true as const,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'LibreWXR metadata fetch failed' },
      { status: 502 }
    )
  }
}
