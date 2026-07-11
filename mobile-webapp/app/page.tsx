"use client"

import { useEffect, useMemo, useState } from "react"
import {
  isObservatoryOverlayStatus,
  observatoryOverlayStatusLabel,
  type ObservatoryOverlayStatus,
} from "../lib/observatory-overlay-status"

const STREAM_URL =
  process.env.NEXT_PUBLIC_CAMERA_STREAM_URL ??
  "https://cam.pomfretastro.org/camera/stream"
const OBSERVATORY_STATUS_URL =
  process.env.NEXT_PUBLIC_OBSERVATORY_STATUS_URL ??
  "https://www.pomfretastro.org/api/imaging/observatory-status"

function formatOverlayDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function allSkyCameraStatusUrl(streamUrl: string): string | null {
  try {
    const u = new URL(streamUrl)
    if (/\/camera\//.test(u.pathname)) return new URL("status", streamUrl).href
    return new URL("/status", streamUrl).href
  } catch {
    return null
  }
}

function valueClass(label: string, value: string): string {
  if (value === "—") return "overlay-value overlay-value-green"
  if (
    label === "Observatory Status" &&
    (value === "Busy" || value === "Closed" || value === "Disconnected")
  ) {
    return "overlay-value overlay-value-red"
  }
  if (label === "Cloud" && value.endsWith("%")) {
    const n = Number(value.replace("%", ""))
    return Number.isFinite(n) && n > 20 ? "overlay-value overlay-value-red" : "overlay-value overlay-value-green"
  }
  if (label === "Wind" && value.endsWith("km/h")) {
    const n = Number(value.replace("km/h", "").trim())
    return Number.isFinite(n) && n > 36 ? "overlay-value overlay-value-red" : "overlay-value overlay-value-green"
  }
  if (label === "Humidity" && value.endsWith("%")) {
    const n = Number(value.replace("%", ""))
    return Number.isFinite(n) && n > 90 ? "overlay-value overlay-value-red" : "overlay-value overlay-value-green"
  }
  if (label === "Raining") {
    return value === "True" ? "overlay-value overlay-value-red" : "overlay-value overlay-value-green"
  }
  return "overlay-value overlay-value-green"
}

export default function HomePage() {
  const [src, setSrc] = useState(STREAM_URL)
  const [now, setNow] = useState(() => new Date())
  const [lastFrameAt, setLastFrameAt] = useState<Date | null>(null)
  const [obsMode, setObsMode] = useState<"manual" | "auto" | null>(null)
  const [serverObsStatus, setServerObsStatus] = useState<ObservatoryOverlayStatus | null>(null)
  const [cloudPct, setCloudPct] = useState<number | null>(null)
  const [windKmh, setWindKmh] = useState<number | null>(null)
  const [tempC, setTempC] = useState<number | null>(null)
  const [humidityPct, setHumidityPct] = useState<number | null>(null)
  const [raining, setRaining] = useState<boolean | null>(null)

  useEffect(() => {
    const sep = STREAM_URL.includes("?") ? "&" : "?"
    setSrc(`${STREAM_URL}${sep}t=${Date.now()}`)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const loadObservatory = async () => {
      try {
        const res = await fetch(OBSERVATORY_STATUS_URL, { cache: "no-store" })
        const data = (await res.json()) as { ok?: boolean; mode?: string; status?: string }
        if (res.ok && data?.ok) {
          if (data.mode === "manual" || data.mode === "auto") setObsMode(data.mode)
          if (typeof data.status === "string" && isObservatoryOverlayStatus(data.status)) {
            setServerObsStatus(data.status)
          } else {
            setServerObsStatus(null)
          }
        } else {
          setServerObsStatus(null)
        }
      } catch {
        setServerObsStatus(null)
      }
    }

    const loadWeather = async () => {
      try {
        const res = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=41.9159&longitude=-71.9626&current=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=auto",
          { cache: "no-store" }
        )
        const data = (await res.json()) as {
          current?: {
            temperature_2m?: number
            relative_humidity_2m?: number
            wind_speed_10m?: number
          }
        }
        const c = data.current
        if (!c) {
          setWindKmh(null)
          setTempC(null)
          setHumidityPct(null)
          return
        }
        setTempC(typeof c.temperature_2m === "number" && Number.isFinite(c.temperature_2m) ? c.temperature_2m : null)
        setHumidityPct(
          typeof c.relative_humidity_2m === "number" && Number.isFinite(c.relative_humidity_2m)
            ? c.relative_humidity_2m
            : null
        )
        setWindKmh(typeof c.wind_speed_10m === "number" && Number.isFinite(c.wind_speed_10m) ? c.wind_speed_10m : null)
      } catch {
        setWindKmh(null)
        setTempC(null)
        setHumidityPct(null)
      }
    }

    void loadObservatory()
    void loadWeather()
    const obsId = window.setInterval(() => void loadObservatory(), 60_000)
    const wxId = window.setInterval(() => void loadWeather(), 60_000)
    return () => {
      window.clearInterval(obsId)
      window.clearInterval(wxId)
    }
  }, [])

  useEffect(() => {
    const statusUrl = allSkyCameraStatusUrl(STREAM_URL)
    if (!statusUrl) return

    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(statusUrl, {
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          sensors?: {
            allSkyCam?: {
              mode?: string
              autoMode?: boolean
              lastStreamFrameIso?: string | null
              lastAutoFrameIso?: string | null
              ascCloud?: {
                cloudCoverPercent?: number | null
                rain?: { detected?: boolean } | null
              }
            }
          }
        }
        const cam = data?.sensors?.allSkyCam
        const ascCloud = cam?.ascCloud?.cloudCoverPercent
        if (typeof ascCloud === "number" && Number.isFinite(ascCloud) && !cancelled) {
          setCloudPct(ascCloud)
        }
        const rainDetected = cam?.ascCloud?.rain?.detected
        if (!cancelled) {
          setRaining(typeof rainDetected === "boolean" ? rainDetected : null)
        }
        const iso =
          cam?.mode === "auto" ||
          cam?.mode === "half_hour" ||
          cam?.mode === "hour" ||
          cam?.autoMode
            ? cam?.lastAutoFrameIso ?? cam?.lastStreamFrameIso
            : cam?.lastStreamFrameIso
        if (typeof iso === "string" && iso.length > 0 && !cancelled) {
          const d = new Date(iso)
          if (!Number.isNaN(d.getTime())) setLastFrameAt(d)
        }
      } catch {
        // keep previous value
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const overlayRows = useMemo(() => {
    const obsText = observatoryOverlayStatusLabel(serverObsStatus)
    const cloudText = cloudPct != null && Number.isFinite(cloudPct) ? `${Math.round(cloudPct)}%` : "—"
    const windText = windKmh != null && Number.isFinite(windKmh) ? `${windKmh.toFixed(0)} km/h` : "—"
    const tempText = tempC != null && Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : "—"
    const humText = humidityPct != null && Number.isFinite(humidityPct) ? `${Math.round(humidityPct)}%` : "—"
    const rainingText = raining === true ? "True" : raining === false ? "False" : "—"
    return [
      ["Current Time", formatOverlayDateTime(now)],
      ["ASC View Last Updated", lastFrameAt ? formatOverlayDateTime(lastFrameAt) : "—"],
      ["Observatory Status", obsText],
      ["Cloud", cloudText],
      ["Wind", windText],
      ["Temperature", tempText],
      ["Humidity", humText],
      ["Raining", rainingText],
    ]
  }, [now, lastFrameAt, serverObsStatus, cloudPct, windKmh, tempC, humidityPct, raining])

  return (
    <main>
      <div className="frame-page">
        <div className="frame-shell">
          <div className="stream-stage">
            <img
              className="stream"
              src={src}
              alt="All sky camera stream"
            />
            <div className="overlay">
              {overlayRows.map(([k, v]) => (
                <div key={k}>
                  <span className="overlay-key">{k}: </span>
                  <span className={valueClass(k, v)}>{v}</span>
                </div>
              ))}
            </div>
            <div className="compass" role="img" aria-label="Compass: north up, south down, east left, west right">
              <div className="compass-cross-v" />
              <div className="compass-cross-h" />
              <span className="compass-letter compass-n">N</span>
              <span className="compass-letter compass-e">E</span>
              <span className="compass-letter compass-w">W</span>
              <span className="compass-letter compass-s">S</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
