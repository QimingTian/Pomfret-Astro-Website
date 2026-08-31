'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import { moonPhaseInfo, moonRiseSet } from '@/lib/moon-avoidance'
import type { AstroForecastSnapshot } from '@/lib/weather/astro-forecast'
import WeatherAstroTimelineStrip from './WeatherAstroTimelineStrip'
import WeatherCurrentConditionsBar from './WeatherCurrentConditionsBar'

const LibreWxrRadarMap = dynamic(() => import('@/components/LibreWxrRadarMap'), { ssr: false })

function formatLocalTime(d: Date | null, timeZone: string): string | null {
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Borean Astro–style weather layout: conditions bar, tonight timeline, radar (+ maps when available). */
export default function ObservatoryWeatherDashboard() {
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
    setLoading(true)
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
    const id = window.setInterval(() => void loadForecast(), 300_000)
    return () => window.clearInterval(id)
  }, [loadForecast])

  return (
    <div className="space-y-6">
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

      {forecast?.error ? (
        <p className="text-sm text-red-400/90 shrink-0">{forecast.error}</p>
      ) : null}

      {forecast?.ok ? (
        <WeatherAstroTimelineStrip hours={forecast.hours} astroBlocks={forecast.astroBlocks} />
      ) : null}

      <div className="min-w-0">
        <LibreWxrRadarMap compact />
      </div>
    </div>
  )
}
