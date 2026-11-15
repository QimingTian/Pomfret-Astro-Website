'use client'

import { useCallback, useEffect, useState } from 'react'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import type { AstroForecastSnapshot } from '@/lib/weather/astro-forecast'

function metric(value: number | null | undefined, unit: string, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—'
}

export function MonitorWeatherPane() {
  const { site, siteId } = useObservatorySite()
  const [forecast, setForecast] = useState<AstroForecastSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const loadForecast = useCallback(async () => {
    try {
      const res = await observatorySiteFetch('/api/weather/astro-forecast', siteId, { cache: 'no-store' })
      const data = (await res.json()) as AstroForecastSnapshot
      setForecast(data)
    } catch {
      setForecast(null)
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    setForecast(null)
    setLoading(true)
    void loadForecast()
    const id = window.setInterval(() => void loadForecast(), 60_000)
    return () => window.clearInterval(id)
  }, [loadForecast])

  const current = forecast?.current
  const observedAt = current?.timeSec != null && Number.isFinite(current.timeSec)
    ? new Date(current.timeSec * 1000).toLocaleTimeString(undefined, {
        timeZone: site.timezone,
        hour: 'numeric',
        minute: '2-digit',
      })
    : null
  const metrics = [
    ['Temperature', metric(current?.tempC, '°C', 1)],
    ['Feels like', metric(current?.feelsLikeC, '°C', 1)],
    ['Dew point', metric(current?.dewPointC, '°C', 1)],
    ['Humidity', metric(current?.humidity, '%')],
    ['Cloud cover', metric(current?.cloudCover, '%')],
    ['Low cloud', metric(current?.cloudLow, '%')],
    ['Mid cloud', metric(current?.cloudMid, '%')],
    ['High cloud', metric(current?.cloudHigh, '%')],
    ['Wind speed', metric(current?.windKmh, ' km/h')],
    ['Wind gusts', metric(current?.windGustKmh, ' km/h')],
    ['Wind direction', metric(current?.windDirectionDeg, '°')],
    ['Precipitation', metric(current?.precipitationMm, ' mm', 1)],
    ['Rain', metric(current?.rainMm, ' mm', 1)],
    ['Snowfall', metric(current?.snowfallCm, ' cm', 1)],
    ['Pressure', metric(current?.pressureHpa, ' hPa')],
    ['Visibility', current?.visibilityM == null ? '—' : metric(current.visibilityM / 1000, ' km', 1)],
  ]

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto">
      <p className="mb-2 text-xs text-white/50">
        {loading ? 'Loading conditions…' : `Latest model conditions${observedAt ? ` · ${observedAt}` : ''}`}
      </p>
      {forecast?.error ? <p className="mb-2 text-xs text-red-400">{forecast.error}</p> : null}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-white/45">{label}</p>
            <p className="text-sm font-medium text-white">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
