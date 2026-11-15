'use client'

import { useCallback, useEffect, useState } from 'react'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import type { AstroForecastSnapshot } from '@/lib/weather/astro-forecast'
import { glassSurface } from '@/lib/glass-ui'

function metric(value: number | null | undefined, unit: string, digits = 0): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—'
}

export function MonitorWeatherPane() {
  const { siteId } = useObservatorySite()
  const [forecast, setForecast] = useState<AstroForecastSnapshot | null>(null)

  const loadForecast = useCallback(async () => {
    try {
      const res = await observatorySiteFetch('/api/weather/astro-forecast', siteId, { cache: 'no-store' })
      const data = (await res.json()) as AstroForecastSnapshot
      setForecast(data)
    } catch {
      setForecast(null)
    }
  }, [siteId])

  useEffect(() => {
    setForecast(null)
    void loadForecast()
    const id = window.setInterval(() => void loadForecast(), 60_000)
    return () => window.clearInterval(id)
  }, [loadForecast])

  const current = forecast?.current
  const metrics = [
    ['Temperature', metric(current?.tempC, '°C', 1)],
    ['Dew point', metric(current?.dewPointC, '°C', 1)],
    ['Humidity', metric(current?.humidity, '%')],
    ['Cloud cover', metric(current?.cloudCover, '%')],
    ['Low cloud', metric(current?.cloudLow, '%')],
    ['Mid cloud', metric(current?.cloudMid, '%')],
    ['High cloud', metric(current?.cloudHigh, '%')],
    ['Wind speed', metric(current?.windKmh, ' km/h')],
    ['Wind gusts', metric(current?.windGustKmh, ' km/h')],
    ['Precipitation', metric(current?.precipitationMm, ' mm', 1)],
    ['Rain', metric(current?.rainMm, ' mm', 1)],
    ['Snowfall', metric(current?.snowfallCm, ' cm', 1)],
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-y-auto">
      {forecast?.error ? <p className="mb-2 text-xs text-red-400">{forecast.error}</p> : null}
      <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className={`glass-pill ${glassSurface} flex flex-col items-start px-3 py-2.5 text-left`}
          >
            <p className="text-[10px] uppercase tracking-wide text-white/45">{label}</p>
            <p className="text-sm font-medium text-white">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
