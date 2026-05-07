'use client'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/lib/store'
import MJPEGStream from '@/components/MJPEGStream'

type ObservatoryApiStatus =
  | 'ready'
  | 'busy_in_use'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

function observatoryStatusLabel(status: ObservatoryApiStatus | null): string {
  if (!status) return '—'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy'
  return 'Closed'
}

function formatOverlayDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Same host as MJPEG: camera_service GET /status or GET /camera/status. */
function allSkyCameraStatusUrl(streamUrl: string | null | undefined): string | null {
  if (!streamUrl) return null
  try {
    const u = new URL(streamUrl)
    if (/\/camera\//.test(u.pathname)) {
      return new URL('status', streamUrl).href
    }
    return new URL('/status', streamUrl).href
  } catch {
    return null
  }
}

const overlayTitleClass = 'text-white'
const overlayValueGreen = 'text-emerald-400'
const overlayValueRed = 'text-red-400'

function overlayValueClass(red: boolean): string {
  return red ? overlayValueRed : overlayValueGreen
}

const overlayTextShadowStyle: CSSProperties = {
  textShadow: '0 1px 4px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.55)',
}

/** All-sky frame: north up; axis-aligned cross. */
function AscCompassRose({ className = '' }: { className?: string }) {
  const letter =
    'absolute z-[1] font-semibold leading-none text-white/95 text-[0.8rem] sm:text-[1.05rem]'
  const outer = `pointer-events-none absolute bottom-0 left-0 z-10 px-3 pb-2 sm:px-4 sm:pb-3 ${className}`
  return (
    <div className={outer} role="img" aria-label="Compass: north up, south down, east left, west right on frame">
      <div className="relative h-[4.5rem] w-[4.5rem] sm:h-[7rem] sm:w-[7rem]">
        <div
          className="pointer-events-none absolute left-1/2 top-[22%] bottom-[22%] z-0 w-[2px] -translate-x-1/2 bg-white/95"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-[22%] right-[22%] top-1/2 z-0 h-[2px] -translate-y-1/2 bg-white/95"
          aria-hidden
        />
        <span style={overlayTextShadowStyle} className={`${letter} left-1/2 top-0 -translate-x-1/2`}>
          N
        </span>
        <span style={overlayTextShadowStyle} className={`${letter} left-0 top-1/2 -translate-y-1/2`}>
          E
        </span>
        <span style={overlayTextShadowStyle} className={`${letter} right-0 top-1/2 -translate-y-1/2`}>
          W
        </span>
        <span style={overlayTextShadowStyle} className={`${letter} bottom-0 left-1/2 -translate-x-1/2`}>
          S
        </span>
      </div>
    </div>
  )
}

const streamAreaClass =
  'relative w-full overflow-hidden rounded-lg bg-black min-h-[420px] max-h-[calc(100vh-16rem)] sm:min-h-[420px]'

export default function CameraPage() {
  const controller = useAppStore((s) => s.controllers.find((c) => c.roles.includes('cameras')))
  const streamURL = controller?.apiClient?.getStreamURL()

  const [now, setNow] = useState(() => new Date())
  const [lastFrameAt, setLastFrameAt] = useState<Date | null>(null)
  const [obsStatus, setObsStatus] = useState<ObservatoryApiStatus | null>(null)
  const [cloudPct, setCloudPct] = useState<number | null>(null)
  const [windKmh, setWindKmh] = useState<number | null>(null)
  const [tempC, setTempC] = useState<number | null>(null)
  const [humidityPct, setHumidityPct] = useState<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const loadObservatory = useCallback(async () => {
    try {
      const res = await fetch('/api/imaging/observatory-status')
      const data = (await res.json()) as { ok?: boolean; status?: string }
      if (res.ok && data?.ok && typeof data.status === 'string') {
        setObsStatus(data.status as ObservatoryApiStatus)
      } else {
        setObsStatus(null)
      }
    } catch {
      setObsStatus(null)
    }
  }, [])

  const loadWeather = useCallback(async () => {
    try {
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=41.9159&longitude=-71.9626&current=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m&timezone=auto'
      )
      const data = (await res.json()) as {
        current?: {
          temperature_2m?: number
          relative_humidity_2m?: number
          cloud_cover?: number
          wind_speed_10m?: number
        }
      }
      const c = data.current
      if (!c) {
        setCloudPct(null)
        setWindKmh(null)
        setTempC(null)
        setHumidityPct(null)
        return
      }
      setTempC(typeof c.temperature_2m === 'number' && Number.isFinite(c.temperature_2m) ? c.temperature_2m : null)
      setHumidityPct(
        typeof c.relative_humidity_2m === 'number' && Number.isFinite(c.relative_humidity_2m)
          ? c.relative_humidity_2m
          : null
      )
      setCloudPct(typeof c.cloud_cover === 'number' && Number.isFinite(c.cloud_cover) ? c.cloud_cover : null)
      setWindKmh(typeof c.wind_speed_10m === 'number' && Number.isFinite(c.wind_speed_10m) ? c.wind_speed_10m : null)
    } catch {
      setCloudPct(null)
      setWindKmh(null)
      setTempC(null)
      setHumidityPct(null)
    }
  }, [])

  useEffect(() => {
    void loadObservatory()
    void loadWeather()
    const obsId = window.setInterval(() => void loadObservatory(), 60_000)
    const wxId = window.setInterval(() => void loadWeather(), 300_000)
    return () => {
      window.clearInterval(obsId)
      window.clearInterval(wxId)
    }
  }, [loadObservatory, loadWeather])

  useEffect(() => {
    const statusUrl = allSkyCameraStatusUrl(streamURL)
    if (!statusUrl) {
      setLastFrameAt(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(statusUrl, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          sensors?: { allSkyCam?: { lastStreamFrameIso?: string | null } }
        }
        const iso = data?.sensors?.allSkyCam?.lastStreamFrameIso
        if (typeof iso === 'string' && iso.length > 0 && !cancelled) {
          const d = new Date(iso)
          if (!Number.isNaN(d.getTime())) {
            setLastFrameAt(d)
          }
        }
      } catch {
        /* keep previous */
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [streamURL])

  const overlay = useMemo(() => {
    const obsText = observatoryStatusLabel(obsStatus)
    const obsValueRed = obsText === 'Busy' || obsText === 'Closed'

    const cloudText =
      cloudPct != null && Number.isFinite(cloudPct) ? `${Math.round(cloudPct)}%` : '—'
    const cloudValueRed = cloudPct != null && Number.isFinite(cloudPct) && cloudPct > 20

    const windText =
      windKmh != null && Number.isFinite(windKmh) ? `${windKmh.toFixed(0)} km/h` : '—'
    const windValueRed = windKmh != null && Number.isFinite(windKmh) && windKmh > 36

    const tempText = tempC != null && Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : '—'

    const humText =
      humidityPct != null && Number.isFinite(humidityPct) ? `${Math.round(humidityPct)}%` : '—'
    const humValueRed = humidityPct != null && Number.isFinite(humidityPct) && humidityPct > 90

    const dashClass = overlayValueGreen

    return (
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-[min(100%,min(92vw,28rem))] space-y-0.5 px-2.5 py-1.5 text-left text-[0.8rem] leading-tight sm:space-y-1 sm:px-3 sm:py-2 sm:text-[0.9375rem] sm:leading-snug"
        style={overlayTextShadowStyle}
      >
        <p className="break-words">
          <span className={overlayTitleClass}>Current Time: </span>
          <span className={overlayValueClass(false)}>{formatOverlayDateTime(now)}</span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>ASC View Last Updated: </span>
          <span className={lastFrameAt ? overlayValueGreen : dashClass}>
            {lastFrameAt ? formatOverlayDateTime(lastFrameAt) : '—'}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Observatory Status: </span>
          <span
            className={
              obsText === '—' ? dashClass : obsValueRed ? overlayValueRed : overlayValueGreen
            }
          >
            {obsText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Cloud: </span>
          <span className={cloudText === '—' ? dashClass : overlayValueClass(cloudValueRed)}>
            {cloudText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Wind: </span>
          <span className={windText === '—' ? dashClass : overlayValueClass(windValueRed)}>
            {windText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Temperature: </span>
          <span className={tempText === '—' ? dashClass : overlayValueGreen}>{tempText}</span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Humidity: </span>
          <span className={humText === '—' ? dashClass : overlayValueClass(humValueRed)}>
            {humText}
          </span>
        </p>
      </div>
    )
  }, [now, lastFrameAt, obsStatus, cloudPct, windKmh, tempC, humidityPct])

  if (!controller) {
    return (
      <div className="flex h-full flex-col lg:-translate-x-3">
        <h1 className="mb-3 text-xl font-semibold text-apple-dark dark:text-white sm:mb-4 sm:text-2xl">
          All Sky Camera
        </h1>
        <div className="min-h-0 flex-1 pb-4 sm:pb-8">
          <div className={`${streamAreaClass} min-h-[400px]`}>
            {overlay}
            <AscCompassRose />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col lg:-translate-x-3">
      <h1 className="mb-3 text-xl font-semibold text-apple-dark dark:text-white sm:mb-4 sm:text-2xl">
        All Sky Camera
      </h1>
      <div className="min-h-0 flex-1 pb-4 sm:pb-8">
        <div className="mt-3 space-y-3 sm:mt-6">
          <div className={streamAreaClass}>
            {overlay}
            <AscCompassRose />
            <MJPEGStream
              url={streamURL || ''}
              className="absolute inset-0 h-full w-full"
              minimal
              fill
            />
          </div>
          <p className="text-center text-[0.7rem] sm:text-xs text-gray-500 dark:text-gray-400">
            Powered by the Pomfret Observatory All-Sky Camera System (ZWO ASI662MC &amp; Raspberry Pi).
          </p>
        </div>
      </div>
    </div>
  )
}
