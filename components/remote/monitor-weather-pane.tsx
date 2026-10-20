'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import { moonPhaseInfo, moonRiseSet } from '@/lib/moon-avoidance'
import type { AstroForecastSnapshot } from '@/lib/weather/astro-forecast'
import WeatherCurrentConditionsBar from '@/components/weather/WeatherCurrentConditionsBar'

const LibreWxrRadarMap = dynamic(() => import('@/components/LibreWxrRadarMap'), { ssr: false })

function formatLocalTime(d: Date | null, timeZone: string): string | null {
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' })
}

export function MonitorWeatherPane() {
  const { site, siteId } = useObservatorySite()
  const [forecast, setForecast] = useState<AstroForecastSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const moon = useMemo(() => {
    const now = new Date()
    const phase = moonPhaseInfo(now)
    const { rise, set } = moonRiseSet(now, site.observerLatDeg, site.observerLonDeg)
    return {
      phaseName: phase.name,
      illuminationPct: phase.illumination * 100,
      moonrise: formatLocalTime(rise, site.timezone),
      moonset: formatLocalTime(set, site.timezone),
    }
  }, [site.observerLatDeg, site.observerLonDeg, site.timezone])

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
    void loadForecast()
    const id = window.setInterval(() => void loadForecast(), 60_000)
    return () => window.clearInterval(id)
  }, [loadForecast])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <WeatherCurrentConditionsBar
        tempC={forecast?.current.tempC ?? null}
        humidity={forecast?.current.humidity ?? null}
        cloudCover={forecast?.current.cloudCover ?? null}
        windKmh={forecast?.current.windKmh ?? null}
        loading={loading}
        moonPhaseName={moon.phaseName}
        moonIlluminationPct={moon.illuminationPct}
        moonrise={moon.moonrise}
        moonset={moon.moonset}
      />
      {forecast?.error ? <p className="shrink-0 px-1 text-xs text-red-400/90">{forecast.error}</p> : null}
      <div className="min-h-0 flex-1">
        <LibreWxrRadarMap fill />
      </div>
    </div>
  )
}
