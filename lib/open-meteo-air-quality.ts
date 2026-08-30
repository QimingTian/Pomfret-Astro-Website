import { currentObservatorySite } from '@/lib/observatory-site-scope'

export type OpenMeteoAirQuality = {
  usAqi: number | null
}

export type UsAqiCategory =
  | 'Good'
  | 'Moderate'
  | 'Unhealthy for Sensitive Groups'
  | 'Unhealthy'
  | 'Very Unhealthy'
  | 'Hazardous'

export function openMeteoAirQualityUrl(): string {
  return (
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${currentObservatorySite().weatherLat}&longitude=${currentObservatorySite().weatherLon}` +
    '&current=us_aqi&timezone=auto'
  )
}

export function usAqiCategory(aqi: number): UsAqiCategory {
  if (aqi <= 50) return 'Good'
  if (aqi <= 100) return 'Moderate'
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups'
  if (aqi <= 200) return 'Unhealthy'
  if (aqi <= 300) return 'Very Unhealthy'
  return 'Hazardous'
}

export function formatUsAqiLabel(aqi: number | null): string {
  if (aqi == null || !Number.isFinite(aqi)) return '—'
  const n = Math.round(aqi)
  return `${usAqiCategory(n)} (${n})`
}

/** Red at EPA “Unhealthy for Sensitive Groups” and worse. */
export function usAqiIsRed(aqi: number | null): boolean {
  return aqi != null && Number.isFinite(aqi) && aqi > 100
}

export async function fetchOpenMeteoAirQuality(): Promise<OpenMeteoAirQuality> {
  try {
    const res = await fetch(openMeteoAirQualityUrl(), { cache: 'no-store' })
    const data = (await res.json()) as {
      current?: { us_aqi?: number }
    }
    const raw = data.current?.us_aqi
    return {
      usAqi: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
    }
  } catch {
    return { usAqi: null }
  }
}
