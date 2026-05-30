'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AllSkyCameraView from '@/components/AllSkyCameraView'
import { useAppStore } from '@/lib/store'
import type { WeatherModel } from '@/lib/types'
import { moonAltDeg, moonPhaseInfo } from '@/lib/moon-avoidance'

/* ------------------------------------------------------------------ */
/*  Moon display helpers (math lives in lib/moon-avoidance.ts)        */
/* ------------------------------------------------------------------ */

function findMoonRiseSet(now: Date): { moonrise: Date | null; moonset: Date | null } {
  const STEP = 5 * 60 * 1000
  const HORIZON = -0.83
  const startMs = now.getTime()
  const endMs = startMs + 24 * 3600 * 1000

  let moonrise: Date | null = null, moonset: Date | null = null
  let prevAlt = moonAltDeg(now)

  for (let ms = startMs + STEP; ms <= endMs; ms += STEP) {
    const alt = moonAltDeg(new Date(ms))
    if (!moonrise && prevAlt < HORIZON && alt >= HORIZON) moonrise = new Date(ms)
    if (!moonset && prevAlt >= HORIZON && alt < HORIZON) moonset = new Date(ms)
    if (moonrise && moonset) break
    prevAlt = alt
  }
  return { moonrise, moonset }
}

/** NASA SVS Dial-A-Moon image URL for a given UTC instant. Real lunar photo with
 *  correct phase and libration, rendered hourly for each year by NASA's Scientific
 *  Visualization Studio. We proxy through our own /api/moon-svs route so the user's
 *  browser only contacts our origin (NASA's CDN can be slow or blocked on some
 *  networks). The proxy caches aggressively on Vercel edge. */
function nasaMoonImageUrl(when: Date): string {
  const supported = new Set([2024, 2025, 2026])
  const utcYear = when.getUTCFullYear()
  const year = supported.has(utcYear) ? utcYear : 2026
  const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0)
  const hourOfYear = Math.floor((when.getTime() - yearStartMs) / 3600000)
  const frame = Math.max(1, Math.min(8760, hourOfYear + 1))
  return `/api/moon-svs?year=${year}&frame=${frame}`
}

/* ------------------------------------------------------------------ */
/*  Cloud Map component                                               */
/* ------------------------------------------------------------------ */

function NOAAGoesCloudMap() {
  const store = useAppStore()
  const imageURL = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif'
  // Start at 0 so SSR and first client paint produce identical markup. After mount we
  // bump to a real timestamp to bust cache.
  const [refreshKey, setRefreshKey] = useState(0)

  const handleImageLoad = () => {
    store.addLog({ module: 'noaa-goes', level: 'info', message: 'NOAA GOES satellite image loaded successfully' })
  }

  useEffect(() => {
    setRefreshKey(Date.now())
    const interval = setInterval(() => {
      store.addLog({ module: 'noaa-goes', level: 'info', message: 'Auto-refreshing NOAA GOES satellite image' })
      setRefreshKey(Date.now())
    }, 600000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-6">Cloud Map</h1>
      <div className="relative w-full rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ aspectRatio: '4 / 3' }}>
        <img
          src={`/api/noaa-goes?url=${encodeURIComponent(imageURL)}&t=${refreshKey}`}
          alt="NOAA GOES-East Satellite Cloud Map Animation"
          key={refreshKey}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scale(2)', transformOrigin: '100% 0%' }}
          onLoad={handleImageLoad}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Moon section component                                            */
/* ------------------------------------------------------------------ */

function MoonSection() {
  // All Date.now()-derived values must wait until after mount to avoid SSR
  // hydration mismatches (server renders at build time, client renders at view time).
  const [nowMs, setNowMs] = useState<number | null>(null)
  const [offsetHours, setOffsetHours] = useState(0)

  useEffect(() => {
    setNowMs(Date.now())
  }, [])

  const selectedDate = useMemo(
    () => (nowMs == null ? null : new Date(nowMs + offsetHours * 3600_000)),
    [nowMs, offsetHours]
  )
  const imageUrl = useMemo(
    () => (selectedDate ? nasaMoonImageUrl(selectedDate) : null),
    [selectedDate]
  )
  const phase = useMemo(() => (selectedDate ? moonPhaseInfo(selectedDate) : null), [selectedDate])
  const altitude = useMemo(() => (selectedDate ? moonAltDeg(selectedDate) : null), [selectedDate])
  const riseSet = useMemo(
    () => (selectedDate ? findMoonRiseSet(selectedDate) : null),
    [selectedDate]
  )

  const fmtTime = (d: Date | null) => {
    if (!d) return '—'
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const fmtSelected = selectedDate
    ? selectedDate.toLocaleString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  const TICK_SPACING = 4.5
  const HALF_RANGE = 84
  const PADDING = 60

  const midnightOffsets = useMemo(() => {
    if (nowMs == null) return []
    const now = new Date(nowMs)
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const result: { label: string; offsetH: number }[] = []
    for (let d = -6; d <= 6; d++) {
      const mid = todayMid + d * 86400_000
      const offsetH = Math.round((mid - nowMs) / 3600_000)
      const dt = new Date(mid)
      result.push({
        label: d === 0 ? 'TODAY' : dt.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
        offsetH,
      })
    }
    return result
  }, [nowMs])

  const midnightHourSet = useMemo(
    () => new Set(midnightOffsets.map((d) => d.offsetH)),
    [midnightOffsets]
  )

  const scrubberRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const dragStartX = useRef(0)
  const dragStartOffset = useRef(0)

  const handleScrubStart = useCallback(
    (clientX: number) => {
      draggingRef.current = true
      dragStartX.current = clientX
      dragStartOffset.current = offsetHours
    },
    [offsetHours]
  )

  const handleScrubMove = useCallback(
    (clientX: number) => {
      if (!draggingRef.current) return
      const dx = clientX - dragStartX.current
      const dh = Math.round(-dx / TICK_SPACING)
      setOffsetHours(Math.max(-HALF_RANGE, Math.min(HALF_RANGE, dragStartOffset.current + dh)))
    },
    []
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleScrubMove(e.clientX)
    const onUp = () => { draggingRef.current = false }
    const onTouchMove = (e: TouchEvent) => { if (e.touches[0]) handleScrubMove(e.touches[0].clientX) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [handleScrubMove])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-6">Moon</h1>
      <div className="flex flex-col items-center gap-2 justify-center">
        <div
          className="relative w-full isolate"
          style={{ maxWidth: '280px', aspectRatio: '1 / 1', backgroundColor: 'rgb(var(--background-rgb))' }}
        >
          {imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageUrl}
              alt={`Moon at ${fmtSelected}`}
              className="absolute inset-0 h-full w-full object-contain mix-blend-lighten"
            />
          ) : (
            <div className="absolute inset-0 rounded-full bg-white/5" />
          )}
        </div>

        <div className="text-center min-h-[2.5rem]">
          {phase && selectedDate ? (
            <>
              <p className="text-base font-semibold text-white">{phase.name}</p>
              <p className="text-xs text-gray-400">
                {fmtSelected}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {(phase.illumination * 100).toFixed(0)}% illuminated
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">Loading…</p>
          )}
        </div>

        {/* Timeline scrubber — fixed pointer, scrolling ticks */}
        <div className="w-full mt-3 select-none">
          {/* Fixed center indicator */}
          <div className="flex justify-center mb-0.5">
            <svg width="10" height="8" viewBox="0 0 10 8" className="text-sky-400"><path d="M5 8L0 0h10z" fill="currentColor" /></svg>
          </div>

          {/* Scrolling tick area */}
          <div
            ref={scrubberRef}
            className="relative overflow-hidden cursor-pointer"
            style={{ height: 22 }}
            onMouseDown={(e) => handleScrubStart(e.clientX)}
            onTouchStart={(e) => { if (e.touches[0]) handleScrubStart(e.touches[0].clientX) }}
            role="slider"
            aria-label="Scrub moon date and time"
            aria-valuemin={-HALF_RANGE}
            aria-valuemax={HALF_RANGE}
            aria-valuenow={offsetHours}
            tabIndex={0}
          >
            <div
              className="absolute h-full"
              style={{
                left: '50%',
                transform: `translateX(${-offsetHours * TICK_SPACING}px)`,
                transition: draggingRef.current ? 'none' : 'transform 0.15s ease-out',
              }}
            >
              {Array.from({ length: (HALF_RANGE + PADDING) * 2 + 1 }, (_, i) => {
                const hour = i - (HALF_RANGE + PADDING)
                const isMidnight = midnightHourSet.has(hour)
                const isMid = !isMidnight && midnightOffsets.some((m) => (hour - m.offsetH) % 6 === 0)
                return (
                  <div
                    key={hour}
                    className="absolute bottom-0"
                    style={{
                      left: hour * TICK_SPACING,
                      width: 1,
                      height: isMidnight ? 18 : isMid ? 13 : 9,
                      backgroundColor: isMidnight ? 'rgba(255,255,255,0.7)' : isMid ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)',
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* Scrolling day labels */}
          <div className="relative overflow-hidden" style={{ height: 18 }}>
            <div
              className="absolute h-full"
              style={{
                left: '50%',
                transform: `translateX(${-offsetHours * TICK_SPACING}px)`,
                transition: draggingRef.current ? 'none' : 'transform 0.15s ease-out',
              }}
            >
              {midnightOffsets.map((day) => (
                <button
                  key={day.label + day.offsetH}
                  type="button"
                  className={`absolute top-0 whitespace-nowrap text-[11px] font-medium ${day.label === 'TODAY' ? 'text-white' : 'text-gray-500'}`}
                  style={{
                    left: day.offsetH * TICK_SPACING,
                    transform: 'translateX(-50%)',
                  }}
                  onClick={() => setOffsetHours(Math.max(-HALF_RANGE, Math.min(HALF_RANGE, day.offsetH)))}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          {/* Now button */}
          <div className="flex justify-center mt-2">
            <button
              type="button"
              onClick={() => setOffsetHours(0)}
              className="rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c]"
            >
              Now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function WeatherPage() {
  const store = useAppStore()
  const [weather, setWeather] = useState<WeatherModel>(store.weather)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true)
        const response = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=41.9159&longitude=-71.9626&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=auto'
        )
        const data = await response.json()
        
        if (data.current) {
          const weatherData: WeatherModel = {
            temperatureC: data.current.temperature_2m,
            apparentTemperatureC: data.current.apparent_temperature,
            humidityPercent: data.current.relative_humidity_2m,
            precipitationMm: data.current.precipitation,
            cloudCoverPercent: data.current.cloud_cover,
            windSpeed: data.current.wind_speed_10m,
            windGust: data.current.wind_gusts_10m,
            observationTime: new Date(data.current.time),
          }
          setWeather(weatherData)
          store.setWeather(weatherData)
          store.addLog({
            module: 'weather',
            level: 'info',
            message: `Weather updated: Temp ${weatherData.temperatureC?.toFixed(1)}°C, Humidity ${weatherData.humidityPercent?.toFixed(0)}%`,
          })
        }
      } catch (error) {
        store.addLog({
          module: 'weather',
          level: 'error',
          message: `Failed to fetch weather: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
    const interval = setInterval(fetchWeather, 300000) // Update every 5 minutes
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatValue = (value: number | undefined, suffix: string): string => {
    if (value === undefined) return '—'
    if (suffix.includes('%')) {
      return `${value.toFixed(0)}${suffix}`
    }
    if (suffix.includes('mm') || suffix.includes('km')) {
      return `${value.toFixed(0)}${suffix}`
    }
    return `${value.toFixed(1)}${suffix}`
  }

  return (
    <div className="pb-8 lg:-translate-x-3">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Weather</h1>
        <p className="text-gray-600 dark:text-gray-400">Pomfret, CT</p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Powered by Open-Meteo</p>
        {weather.observationTime && (
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Last updated: {weather.observationTime.toLocaleTimeString()}
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">Loading weather data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            {(() => {
              const metrics = [
                { title: 'Temperature', value: formatValue(weather.temperatureC, '°C') },
                { title: 'Apparent Temperature', value: formatValue(weather.apparentTemperatureC, '°C') },
                { title: 'Humidity', value: formatValue(weather.humidityPercent, '%') },
                { title: 'Cloud Cover', value: formatValue(weather.cloudCoverPercent, '%') },
                { title: 'Wind Speed', value: formatValue(weather.windSpeed, ' km/h') },
                { title: 'Wind Gust', value: formatValue(weather.windGust, ' km/h') },
              ]

              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3">
                    {metrics.slice(0, 3).map((metric, index) => (
                      <div
                        key={metric.title}
                        className={`p-6 text-center flex flex-col items-center justify-center ${index < 2 ? 'md:border-r md:border-white/35' : ''}`}
                      >
                        <div className="mb-3">
                          <h3 className="text-lg font-medium text-white">{metric.title}</h3>
                        </div>
                        <p className="text-3xl font-semibold text-apple-dark dark:text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/35" />
                  <div className="grid grid-cols-1 md:grid-cols-3">
                    {metrics.slice(3).map((metric, index) => (
                      <div
                        key={metric.title}
                        className={`p-6 text-center flex flex-col items-center justify-center ${index < 2 ? 'md:border-r md:border-white/35' : ''}`}
                      >
                        <div className="mb-3">
                          <h3 className="text-lg font-medium text-white">{metric.title}</h3>
                        </div>
                        <p className="text-3xl font-semibold text-apple-dark dark:text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      <div className="mt-8 border-t border-black/10 dark:border-white/10 pt-8 grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-6">
        <NOAAGoesCloudMap />
        <div className="hidden md:block bg-white/15 -my-8" />
        <MoonSection />
      </div>

      <div className="mt-8 border-t border-black/10 dark:border-white/10 pt-8" id="all-sky-camera">
        <AllSkyCameraView />
      </div>
    </div>
  )
}
