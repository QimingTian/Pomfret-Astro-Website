'use client'

import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useMember } from '@/hooks/use-member'
import { useObservatoryEnvelope } from '@/hooks/use-observatory-envelope'
import { useAppStore } from '@/lib/store'
import MJPEGStream from '@/components/MJPEGStream'
import {
  allSkyCameraSequenceStatusUrl,
  allSkyCameraStatusUrl,
  DEFAULT_ALL_SKY_STREAM_URL,
  defaultAllSkySequenceStatusUrl,
} from '@/lib/asc-cloud'
import { moonPhaseInfo } from '@/lib/moon-avoidance'
import {
  type AstroConditionScale,
  astroConditionIsRed,
  formatAstroConditionLabel,
} from '@/lib/astro-conditions'
import { fetchOpenMeteoCurrentWeather } from '@/lib/open-meteo-current'
import {
  formatUsAqiLabel,
  fetchOpenMeteoAirQuality,
  usAqiIsRed,
} from '@/lib/open-meteo-air-quality'
import {
  observatoryOverlayStatusIsRed,
  observatoryOverlayStatusLabel,
} from '@/lib/observatory-overlay-status'

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

/** Format ASC photo exposure (microseconds) for the overlay. */
export function formatAscExposureUs(exposureUs: number): string {
  if (!Number.isFinite(exposureUs) || exposureUs < 0) return '—'
  if (exposureUs >= 1_000_000) return `${(exposureUs / 1_000_000).toFixed(2)} s`
  if (exposureUs >= 1_000) return `${(exposureUs / 1_000).toFixed(exposureUs >= 10_000 ? 0 : 1)} ms`
  return `${Math.round(exposureUs)} μs`
}

/** Same host as MJPEG: camera_service GET /status or GET /camera/status. */
function resolveAllSkyStatusUrl(streamUrl: string | null | undefined): string | null {
  return allSkyCameraStatusUrl(streamUrl)
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

const streamAreaClass = 'relative w-full overflow-hidden rounded-lg bg-black'

export default function AllSkyCameraView() {
  const member = useMember()
  const controller = useAppStore((s) => s.controllers.find((c) => c.roles.includes('cameras')))
  const streamURL = controller?.apiClient?.getStreamURL() ?? DEFAULT_ALL_SKY_STREAM_URL
  const { serverStatus: observatoryStatus } = useObservatoryEnvelope({
    siteStreamEnabled: member.status === 'authenticated',
  })

  // Start `now` as null so SSR and first client paint match; populate after mount.
  const [now, setNow] = useState<Date | null>(null)
  const [lastFrameAt, setLastFrameAt] = useState<Date | null>(null)
  const [exposureUs, setExposureUs] = useState<number | null>(null)
  const [gain, setGain] = useState<number | null>(null)
  const [cloudPct, setCloudPct] = useState<number | null>(null)
  const [raining, setRaining] = useState<boolean | null>(null)
  const [windKmh, setWindKmh] = useState<number | null>(null)
  const [windGustKmh, setWindGustKmh] = useState<number | null>(null)
  const [tempC, setTempC] = useState<number | null>(null)
  const [humidityPct, setHumidityPct] = useState<number | null>(null)
  const [usAqi, setUsAqi] = useState<number | null>(null)
  const [transparency, setTransparency] = useState<AstroConditionScale | null>(null)
  const [seeing, setSeeing] = useState<AstroConditionScale | null>(null)
  /** null = unknown / fetch failed; true = Safe; false = Unsafe (20 km ring). */
  const [stormSafe, setStormSafe] = useState<boolean | null>(null)
  const [sequenceActive, setSequenceActive] = useState(false)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const seqUrl = allSkyCameraSequenceStatusUrl(streamURL) ?? defaultAllSkySequenceStatusUrl()
    let cancelled = false
    const loadSeq = async () => {
      try {
        const res = await fetch(seqUrl, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { active?: boolean }
        if (!cancelled) setSequenceActive(data.active === true)
      } catch {
        if (!cancelled) setSequenceActive(false)
      }
    }
    void loadSeq()
    const id = window.setInterval(() => void loadSeq(), 2_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [streamURL])

  useEffect(() => {
    const loadWeather = async () => {
      const [wx, aq] = await Promise.all([
        fetchOpenMeteoCurrentWeather(),
        fetchOpenMeteoAirQuality(),
      ])
      setWindKmh(wx.windSpeedKmh)
      setWindGustKmh(wx.windGustKmh)
      setTempC(wx.temperatureC)
      setHumidityPct(wx.humidityPercent)
      setUsAqi(aq.usAqi)
    }
    void loadWeather()
    const id = window.setInterval(() => void loadWeather(), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadStorm = async () => {
      try {
        const res = await fetch('/api/weather/storm-approach', { cache: 'no-store' })
        const data = (await res.json()) as { safe?: boolean }
        if (cancelled) return
        setStormSafe(res.ok && typeof data.safe === 'boolean' ? data.safe : null)
      } catch {
        if (!cancelled) setStormSafe(null)
      }
    }
    void loadStorm()
    const id = window.setInterval(() => void loadStorm(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadAstro = async () => {
      try {
        const res = await fetch('/api/weather/astro-conditions', { cache: 'no-store' })
        const data = (await res.json()) as {
          transparency?: number | null
          seeing?: number | null
        }
        if (cancelled) return
        if (!res.ok) {
          setTransparency(null)
          setSeeing(null)
          return
        }
        const t = data.transparency
        const s = data.seeing
        setTransparency(
          typeof t === 'number' && t >= 1 && t <= 8 ? (Math.round(t) as AstroConditionScale) : null
        )
        setSeeing(
          typeof s === 'number' && s >= 1 && s <= 8 ? (Math.round(s) as AstroConditionScale) : null
        )
      } catch {
        if (!cancelled) {
          setTransparency(null)
          setSeeing(null)
        }
      }
    }
    void loadAstro()
    const id = window.setInterval(() => void loadAstro(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const statusUrl = resolveAllSkyStatusUrl(streamURL)
    if (!statusUrl) {
      setLastFrameAt(null)
      setExposureUs(null)
      setGain(null)
      setCloudPct(null)
      setRaining(null)
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
          sensors?: {
            allSkyCam?: {
              mode?: string
              autoMode?: boolean
              lastStreamFrameIso?: string | null
              lastAutoFrameIso?: string | null
              exposureUs?: number | null
              gain?: number | null
              autoModeTargetGain?: number | null
              autoTuning?: {
                photoExposureUs?: number | null
              } | null
              ascCloud?: {
                cloudCoverPercent?: number | null
                rain?: {
                  detected?: boolean
                } | null
              }
            }
          }
        }
        const cam = data?.sensors?.allSkyCam
        const ascCloud = cam?.ascCloud?.cloudCoverPercent
        if (
          typeof ascCloud === 'number' &&
          Number.isFinite(ascCloud) &&
          !cancelled
        ) {
          setCloudPct(ascCloud)
        }
        const rainDetected = cam?.ascCloud?.rain?.detected
        if (!cancelled) {
          setRaining(typeof rainDetected === 'boolean' ? rainDetected : null)
        }

        const expRaw =
          typeof cam?.exposureUs === 'number' && Number.isFinite(cam.exposureUs)
            ? cam.exposureUs
            : typeof cam?.autoTuning?.photoExposureUs === 'number' &&
                Number.isFinite(cam.autoTuning.photoExposureUs)
              ? cam.autoTuning.photoExposureUs
              : null
        const gainRaw =
          typeof cam?.gain === 'number' && Number.isFinite(cam.gain)
            ? cam.gain
            : typeof cam?.autoModeTargetGain === 'number' && Number.isFinite(cam.autoModeTargetGain)
              ? cam.autoModeTargetGain
              : null
        if (!cancelled) {
          setExposureUs(expRaw)
          setGain(gainRaw)
        }

        const iso =
          cam?.mode === 'auto' ||
            cam?.mode === 'half_hour' ||
            cam?.mode === 'hour' ||
            cam?.autoMode
            ? cam?.lastAutoFrameIso ?? cam?.lastStreamFrameIso
            : cam?.lastStreamFrameIso
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
    const ascUnavailable = sequenceActive
    const obsText = observatoryOverlayStatusLabel(observatoryStatus)
    const obsValueRed = observatoryOverlayStatusIsRed(observatoryStatus)

    const exposureGainText = ascUnavailable
      ? '—'
      : exposureUs != null && gain != null
        ? `${formatAscExposureUs(exposureUs)} / gain ${Math.round(gain)}`
        : exposureUs != null
          ? `${formatAscExposureUs(exposureUs)} / gain —`
          : gain != null
            ? `— / gain ${Math.round(gain)}`
            : '—'

    const cloudText =
      ascUnavailable || cloudPct == null || !Number.isFinite(cloudPct)
        ? '—'
        : `${Math.round(cloudPct)}%`
    const cloudValueRed =
      !ascUnavailable && cloudPct != null && Number.isFinite(cloudPct) && cloudPct > 20

    const transparencyText = formatAstroConditionLabel(transparency)
    const transparencyValueRed = astroConditionIsRed(transparency)
    const seeingText = formatAstroConditionLabel(seeing)
    const seeingValueRed = astroConditionIsRed(seeing)
    const aqiText = formatUsAqiLabel(usAqi)
    const aqiValueRed = usAqiIsRed(usAqi)

    const windText =
      windKmh != null && Number.isFinite(windKmh) ? `${windKmh.toFixed(0)} km/h` : '—'
    const windValueRed = windKmh != null && Number.isFinite(windKmh) && windKmh > 36

    const windGustText =
      windGustKmh != null && Number.isFinite(windGustKmh) ? `${windGustKmh.toFixed(0)} km/h` : '—'
    const windGustValueRed =
      windGustKmh != null && Number.isFinite(windGustKmh) && windGustKmh > 36

    const tempText = tempC != null && Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : '—'

    const humText =
      humidityPct != null && Number.isFinite(humidityPct) ? `${Math.round(humidityPct)}%` : '—'
    const humValueRed = humidityPct != null && Number.isFinite(humidityPct) && humidityPct > 90

    const rainingText = ascUnavailable
      ? '—'
      : raining === true
        ? 'True'
        : raining === false
          ? 'False'
          : '—'

    const moonIllumPct = now ? Math.round(moonPhaseInfo(now).illumination * 100) : null
    const moonIllumText = moonIllumPct != null ? `${moonIllumPct}%` : '—'

    const dashClass = overlayValueGreen
    const lastFrameText =
      ascUnavailable || !lastFrameAt ? '—' : formatOverlayDateTime(lastFrameAt)

    return (
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-[min(100%,min(92vw,28rem))] space-y-0.5 px-2.5 py-1.5 text-left text-[0.8rem] leading-tight sm:space-y-1 sm:px-3 sm:py-2 sm:text-[0.9375rem] sm:leading-snug"
        style={overlayTextShadowStyle}
      >
        <p className="break-words font-semibold text-white">All Sky Camera</p>
        <p className="break-words">
          <span className={overlayTitleClass}>Current Time: </span>
          <span className={overlayValueClass(false)}>{now ? formatOverlayDateTime(now) : '—'}</span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>ASC View Last Updated: </span>
          <span className={lastFrameText === '—' ? dashClass : overlayValueGreen}>
            {lastFrameText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>ASC Exposure &amp; Gain: </span>
          <span className={exposureGainText === '—' ? dashClass : overlayValueGreen}>
            {exposureGainText}
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
          <span className={overlayTitleClass}>Transparency: </span>
          <span
            className={
              transparencyText === '—' ? dashClass : overlayValueClass(transparencyValueRed)
            }
          >
            {transparencyText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Seeing: </span>
          <span className={seeingText === '—' ? dashClass : overlayValueClass(seeingValueRed)}>
            {seeingText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>AQI: </span>
          <span className={aqiText === '—' ? dashClass : overlayValueClass(aqiValueRed)}>
            {aqiText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Wind: </span>
          <span className={windText === '—' ? dashClass : overlayValueClass(windValueRed)}>
            {windText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Wind Gust: </span>
          <span className={windGustText === '—' ? dashClass : overlayValueClass(windGustValueRed)}>
            {windGustText}
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
        <p className="break-words">
          <span className={overlayTitleClass}>Raining: </span>
          <span
            className={
              rainingText === '—'
                ? dashClass
                : raining
                  ? overlayValueRed
                  : overlayValueGreen
            }
          >
            {rainingText}
          </span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Moon Illumination: </span>
          <span className={moonIllumText === '—' ? dashClass : overlayValueGreen}>{moonIllumText}</span>
        </p>
        <p className="break-words">
          <span className={overlayTitleClass}>Thunderstorm Detection: </span>
          <span
            className={
              stormSafe == null
                ? dashClass
                : stormSafe
                  ? overlayValueGreen
                  : overlayValueRed
            }
          >
            {stormSafe == null ? '—' : stormSafe ? 'Safe' : 'Unsafe'}
          </span>
        </p>
      </div>
    )
  }, [
    sequenceActive,
    now,
    lastFrameAt,
    exposureUs,
    gain,
    observatoryStatus,
    cloudPct,
    transparency,
    seeing,
    usAqi,
    windKmh,
    windGustKmh,
    tempC,
    humidityPct,
    raining,
    stormSafe,
  ])

  const sequenceMessage = (
    <div
      className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black px-4"
      role="status"
      aria-live="polite"
    >
      <p
        className="text-center text-base font-semibold text-white sm:text-lg"
        style={overlayTextShadowStyle}
      >
        All Sky Camera Is Executing A Sequence.
      </p>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <div className={`${streamAreaClass} min-h-[400px]`}>
          {sequenceActive ? sequenceMessage : <MJPEGStream url={streamURL} minimal />}
          {overlay}
          {!sequenceActive ? <AscCompassRose /> : null}
        </div>
      </div>
    </div>
  )
}
