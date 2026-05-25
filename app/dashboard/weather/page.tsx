'use client'

import { useEffect, useMemo, useState } from 'react'
import AllSkyCameraView from '@/components/AllSkyCameraView'
import { useAppStore } from '@/lib/store'
import type { WeatherModel } from '@/lib/types'
import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

/* ------------------------------------------------------------------ */
/*  Moon computation helpers                                          */
/* ------------------------------------------------------------------ */

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const SYNODIC_MONTH = 29.530588853
const NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14, 0)

function normDeg(x: number) { let v = x % 360; if (v < 0) v += 360; return v }
function sinD(d: number) { return Math.sin(d * DEG2RAD) }
function cosD(d: number) { return Math.cos(d * DEG2RAD) }

function moonPhaseInfo(now: Date) {
  const ageDays = (((now.getTime() - NEW_MOON_REF_MS) / 86400000) % SYNODIC_MONTH + SYNODIC_MONTH) % SYNODIC_MONTH
  const fraction = ageDays / SYNODIC_MONTH
  const illumination = (1 - Math.cos(fraction * 2 * Math.PI)) / 2

  let name: string
  if (ageDays < 1.85) name = 'New Moon'
  else if (ageDays < 7.38) name = 'Waxing Crescent'
  else if (ageDays < 9.23) name = 'First Quarter'
  else if (ageDays < 14.77) name = 'Waxing Gibbous'
  else if (ageDays < 16.61) name = 'Full Moon'
  else if (ageDays < 22.15) name = 'Waning Gibbous'
  else if (ageDays < 23.99) name = 'Last Quarter'
  else if (ageDays < 27.68) name = 'Waning Crescent'
  else name = 'New Moon'

  return { ageDays, fraction, illumination, name }
}

/** Simplified Meeus low-accuracy lunar position → equatorial RA/Dec. */
function moonEquatorial(date: Date): { raHours: number; decDeg: number } {
  const jd = date.getTime() / 86400000 + 2440587.5
  const T = (jd - 2451545.0) / 36525

  const L0 = normDeg(218.3165 + 481267.8813 * T)
  const M  = normDeg(134.9634 + 477198.8676 * T)
  const M1 = normDeg(357.5291 + 35999.0503 * T)
  const D  = normDeg(297.8502 + 445267.1115 * T)
  const F  = normDeg(93.2720 + 483202.0175 * T)

  const lon = normDeg(
    L0 + 6.289 * sinD(M) + 1.274 * sinD(2 * D - M) + 0.658 * sinD(2 * D)
       + 0.214 * sinD(2 * M) - 0.186 * sinD(M1) - 0.114 * sinD(2 * F)
  )
  const lat = 5.128 * sinD(F) + 0.281 * sinD(M + F) + 0.278 * sinD(M - F)

  const obl = 23.4393 - 0.0130 * T
  const lonR = lon * DEG2RAD, latR = lat * DEG2RAD, oblR = obl * DEG2RAD
  const ra = Math.atan2(Math.sin(lonR) * Math.cos(oblR) - Math.tan(latR) * Math.sin(oblR), Math.cos(lonR))
  const dec = Math.asin(Math.sin(latR) * Math.cos(oblR) + Math.cos(latR) * Math.sin(oblR) * Math.sin(lonR))

  return { raHours: normDeg(ra * RAD2DEG) / 15, decDeg: dec * RAD2DEG }
}

function moonAltDeg(date: Date): number {
  const { raHours, decDeg } = moonEquatorial(date)
  const jd = date.getTime() / 86400000 + 2440587.5
  const T = (jd - 2451545.0) / 36525
  const gmst = normDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000)
  const lst = normDeg(gmst + OBS_LON_DEG)
  let ha = lst - raHours * 15; if (ha > 180) ha -= 360; if (ha < -180) ha += 360

  const sinAlt = sinD(decDeg) * sinD(OBS_LAT_DEG) + cosD(decDeg) * cosD(OBS_LAT_DEG) * cosD(ha)
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG
}

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

/** Realistic SVG moon disc with radial gradient, crater texture, and soft terminator. */
function MoonPhaseSvg({ fraction, size = 120 }: { fraction: number; size?: number }) {
  const r = size / 2
  const uid = `moon-${size}`
  const waxing = fraction <= 0.5
  const t = waxing ? fraction * 2 : (fraction - 0.5) * 2

  const sweep = waxing ? r * Math.cos(t * Math.PI) : -r * Math.cos(t * Math.PI)
  const litOnRight = waxing
  const darkD = `M 0,${-r} A ${r},${r} 0 0,${litOnRight ? '0' : '1'} 0,${r} A ${Math.abs(sweep)},${r} 0 0,${sweep >= 0 ? '1' : '0'} 0,${-r} Z`

  const craters: Array<{ cx: number; cy: number; r: number; o: number }> = [
    { cx: -0.18, cy: -0.25, r: 0.12, o: 0.13 },
    { cx: 0.22, cy: -0.10, r: 0.09, o: 0.10 },
    { cx: -0.05, cy: 0.30, r: 0.14, o: 0.11 },
    { cx: 0.30, cy: 0.22, r: 0.07, o: 0.12 },
    { cx: -0.32, cy: 0.05, r: 0.08, o: 0.09 },
    { cx: 0.10, cy: -0.38, r: 0.06, o: 0.10 },
    { cx: -0.12, cy: 0.08, r: 0.10, o: 0.08 },
    { cx: 0.35, cy: -0.30, r: 0.05, o: 0.11 },
    { cx: -0.28, cy: -0.35, r: 0.06, o: 0.07 },
    { cx: 0.02, cy: 0.15, r: 0.08, o: 0.09 },
    { cx: -0.38, cy: 0.28, r: 0.05, o: 0.08 },
    { cx: 0.18, cy: 0.38, r: 0.06, o: 0.10 },
  ]

  return (
    <svg width={size} height={size} viewBox={`${-r - 1} ${-r - 1} ${size + 2} ${size + 2}`}>
      <defs>
        <radialGradient id={`${uid}-surf`} cx="0.42" cy="0.38" r="0.58">
          <stop offset="0%" stopColor="#e8e4d4" />
          <stop offset="55%" stopColor="#c9c4b0" />
          <stop offset="100%" stopColor="#8a8474" />
        </radialGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.5" r="0.52">
          <stop offset="85%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(200,195,175,0.18)" />
        </radialGradient>
        <filter id={`${uid}-blur`}>
          <feGaussianBlur stdDeviation={r * 0.045} />
        </filter>
        <clipPath id={`${uid}-clip`}>
          <circle r={r} />
        </clipPath>
      </defs>
      <circle r={r} fill={`url(#${uid}-surf)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        {craters.map((c, i) => (
          <circle key={i} cx={c.cx * r * 2} cy={c.cy * r * 2} r={c.r * r} fill={`rgba(90,85,70,${c.o})`} />
        ))}
      </g>
      <circle r={r} fill={`url(#${uid}-glow)`} />
      <path d={darkD} fill="rgba(10,10,20,0.92)" filter={`url(#${uid}-blur)`} clipPath={`url(#${uid}-clip)`} />
      <circle r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.6} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Cloud Map component                                               */
/* ------------------------------------------------------------------ */

function NOAAGoesCloudMap() {
  const store = useAppStore()
  const imageURL = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif'
  const [refreshKey, setRefreshKey] = useState(Date.now())

  const handleImageLoad = () => {
    store.addLog({ module: 'noaa-goes', level: 'info', message: 'NOAA GOES satellite image loaded successfully' })
  }

  useEffect(() => {
    const interval = setInterval(() => {
      store.addLog({ module: 'noaa-goes', level: 'info', message: 'Auto-refreshing NOAA GOES satellite image' })
      setRefreshKey(Date.now())
    }, 600000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Cloud Map</h1>
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
      <p className="text-xs text-gray-500 mt-2">NOAA GOES-East</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Moon section component                                            */
/* ------------------------------------------------------------------ */

function MoonSection() {
  const now = useMemo(() => new Date(), [])

  const { phase, altitude, riseSet } = useMemo(() => {
    const phase = moonPhaseInfo(now)
    const altitude = moonAltDeg(now)
    const riseSet = findMoonRiseSet(now)
    return { phase, altitude, riseSet }
  }, [now])

  const fmtTime = (d: Date | null) => {
    if (!d) return '—'
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Moon</h1>
      <div className="flex flex-col items-center rounded-lg border border-white/10 p-6 gap-5 justify-center" style={{ aspectRatio: '4 / 3' }}>
        <MoonPhaseSvg fraction={phase.fraction} size={120} />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-white">{phase.name}</p>
          <p className="text-2xl font-semibold text-white">{(phase.illumination * 100).toFixed(0)}%</p>
          <p className="text-xs text-gray-400">illuminated</p>
        </div>
        <div className="w-full grid grid-cols-3 gap-2 text-center text-xs text-gray-400 mt-auto">
          <div>
            <p className="text-white font-medium">{altitude >= 0 ? `${altitude.toFixed(1)}°` : 'Below'}</p>
            <p>Altitude</p>
          </div>
          <div>
            <p className="text-white font-medium">{fmtTime(riseSet.moonrise)}</p>
            <p>Moonrise</p>
          </div>
          <div>
            <p className="text-white font-medium">{fmtTime(riseSet.moonset)}</p>
            <p>Moonset</p>
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

      <div className="mt-8 border-t border-black/10 dark:border-white/10 pt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <NOAAGoesCloudMap />
        <MoonSection />
      </div>

      <div className="mt-8 border-t border-black/10 dark:border-white/10 pt-8" id="all-sky-camera">
        <AllSkyCameraView />
      </div>
    </div>
  )
}
