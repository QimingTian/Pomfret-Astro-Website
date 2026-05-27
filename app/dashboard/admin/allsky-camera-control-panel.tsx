'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAppStore } from '@/lib/store'


type CamStatus = {
  connected: boolean
  streaming: boolean
  mode: CamMode
  autoMode: boolean
  lastStreamFrameIso: string | null
  lastAutoFrameIso: string | null
  fault: string | null
}

const DRIVE_SEQUENCE_ROOT_URL =
  'https://drive.google.com/drive/folders/1aRm-ly3N8CxEUKwUzHQzvumySJrNKXDV'

type SeqStatus = {
  active: boolean
  current_count: number
  total_count: number
  folder_name?: string
  drive_url?: string
  last_error?: string | null
  file_format?: string
  interval?: number
}

const STATUS_POLL_MS = 5_000
const SEQ_POLL_MS = 2_000
const MODE_STORAGE_KEY = 'allsky-camera-mode'

type CamMode = 'stream' | 'auto' | 'off'

function readSavedMode(): CamMode {
  if (typeof window === 'undefined') return 'off'
  const v = localStorage.getItem(MODE_STORAGE_KEY)
  if (v === 'stream' || v === 'auto' || v === 'off') return v
  return 'off'
}

function writeSavedMode(mode: CamMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(MODE_STORAGE_KEY, mode)
}

const btnBase =
  'rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-40 transition-colors'
const btnPrimary = `${btnBase} border-white/25 bg-[#151616] text-white hover:bg-[#1b1c1c]`
const btnDanger = `${btnBase} border-red-500/50 text-red-300 hover:bg-red-500/10`
const btnSuccess = `${btnBase} border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10`

const TRACK_H = 8
const THUMB_D = 22
const ACCENT = '#a3a3a3'
const TRACK_BG = '#374151'

const sliderStaticCSS = `
  .cam-slider,
  .dark .cam-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: ${THUMB_D}px;
    background: transparent !important;
    outline: none !important;
    border: 0 !important;
    border-bottom: 0 !important;
    border-radius: 9999px !important;
    padding: 0 !important;
    margin: 0;
    cursor: pointer;
    box-shadow: none !important;
  }
  .cam-slider:focus,
  .dark .cam-slider:focus {
    outline: none !important;
    border: 0 !important;
    border-bottom: 0 !important;
    box-shadow: none !important;
  }
  .cam-slider::-webkit-slider-runnable-track {
    -webkit-appearance: none;
    height: ${TRACK_H}px;
    border-radius: 9999px;
    border: 0;
    background: var(--cam-track-bg, ${TRACK_BG});
  }
  .cam-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: ${THUMB_D}px;
    height: ${THUMB_D}px;
    border-radius: 50%;
    background: ${ACCENT};
    border: 3px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.45);
    cursor: pointer;
    margin-top: -${(THUMB_D - TRACK_H) / 2}px;
  }
  .cam-slider::-moz-range-track {
    background: var(--cam-track-bg, ${TRACK_BG});
    border-radius: 9999px;
    height: ${TRACK_H}px;
    border: 0;
  }
  .cam-slider::-moz-range-thumb {
    width: ${THUMB_D}px;
    height: ${THUMB_D}px;
    border-radius: 50%;
    background: ${ACCENT};
    border: 3px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.45);
    cursor: pointer;
  }
  .boxed-fields .cam-slider,
  .dark .boxed-fields .cam-slider {
    border: 0 !important;
    border-bottom: 0 !important;
    border-radius: 9999px !important;
    background: transparent !important;
  }
`

function StyledSlider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="cam-slider"
      style={{
        ['--cam-track-bg' as string]: `linear-gradient(to right, ${ACCENT} ${pct}%, ${TRACK_BG} ${pct}%)`,
      } as React.CSSProperties}
    />
  )
}

const labelClass = 'text-xs text-white'
const fieldInput =
  'w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-white dark:border-gray-600 dark:bg-transparent'
const fieldInputCompact =
  'w-[4.5rem] shrink-0 rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-center text-xs font-mono text-white tabular-nums dark:border-gray-600 dark:bg-transparent'

/** ASI662MC gain range; max updated from /status when camera is connected. UI min is always 0. */
const GAIN_UI_MIN = 0
const DEFAULT_GAIN_MAX = 500
const WB_MIN = 0
const WB_MAX = 100

const PHOTO_EXP_MIN_S = 0
/** Log-scale floor when photo exp > 0 (≈32 µs). */
const PHOTO_EXP_LOG_MIN_S = 0.000032
const PHOTO_EXP_MAX_S = 300
const PHOTO_EXP_SLIDER_STEPS = 1000

const VIDEO_EXP_MIN_MS = 0
const VIDEO_EXP_MAX_MS = 2000

const SEQ_COUNT_MIN = 1
const SEQ_COUNT_MAX = 10000
const SEQ_COUNT_SLIDER_MAX = 1000
const SEQ_INTERVAL_MIN = 0
const SEQ_INTERVAL_MAX = 3600

function roundPhotoExposureS(s: number): number {
  if (s <= 0) return 0
  const clamped = Math.min(PHOTO_EXP_MAX_S, s)
  if (clamped < 0.01) return Math.round(clamped * 1000) / 1000
  if (clamped < 1) return Math.round(clamped * 100) / 100
  return Math.round(clamped * 10) / 10
}

function photoExposureToSlider(s: number): number {
  if (s <= 0) return 0
  const minL = Math.log(PHOTO_EXP_LOG_MIN_S)
  const maxL = Math.log(PHOTO_EXP_MAX_S)
  const logS = Math.log(Math.min(PHOTO_EXP_MAX_S, s))
  const t = (logS - minL) / (maxL - minL)
  return Math.max(
    1,
    Math.min(
      PHOTO_EXP_SLIDER_STEPS,
      1 + Math.round(t * (PHOTO_EXP_SLIDER_STEPS - 1)),
    ),
  )
}

function sliderToPhotoExposure(pos: number): number {
  if (pos <= 0) return 0
  const minL = Math.log(PHOTO_EXP_LOG_MIN_S)
  const maxL = Math.log(PHOTO_EXP_MAX_S)
  const t = (Math.max(1, Math.min(PHOTO_EXP_SLIDER_STEPS, pos)) - 1) / (PHOTO_EXP_SLIDER_STEPS - 1)
  return roundPhotoExposureS(Math.exp(minL + t * (maxL - minL)))
}

function validateNumericDraft(
  raw: string,
  min: number,
  max: number,
  decimal: boolean,
): boolean {
  const t = raw.trim()
  if (!t) return false
  if (decimal) {
    if (!/^\d+(\.\d+)?$/.test(t)) return false
    const v = parseFloat(t)
    return Number.isFinite(v) && v >= min && v <= max
  }
  if (!/^\d+$/.test(t)) return false
  const v = Number(t)
  return Number.isFinite(v) && v >= min && v <= max
}

function parseNumericDraft(
  raw: string,
  min: number,
  max: number,
  decimal: boolean,
): number | null {
  if (!validateNumericDraft(raw, min, max, decimal)) return null
  const t = raw.trim()
  const v = decimal ? parseFloat(t) : Number(t)
  return Math.max(min, Math.min(max, v))
}

export type NumericInputHandle = { commit: () => number }

const NumericInput = forwardRef<
  NumericInputHandle,
  {
    value: number
    onChange: (v: number) => void
    min: number
    max: number
    className?: string
    decimal?: boolean
    onValidityChange?: (valid: boolean) => void
  }
>(function NumericInput(
  { value, onChange, min, max, className, decimal = false, onValidityChange },
  ref,
) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  useEffect(() => {
    onValidityChange?.(validateNumericDraft(text, min, max, decimal))
  }, [text, min, max, decimal, onValidityChange])

  const commit = useCallback((): number => {
    const parsed = parseNumericDraft(text, min, max, decimal)
    if (parsed === null) {
      setText(String(value))
      return value
    }
    onChange(parsed)
    setText(String(parsed))
    return parsed
  }, [text, value, decimal, min, max, onChange])

  useImperativeHandle(ref, () => ({ commit }), [commit])

  const handleChange = (raw: string) => {
    if (decimal) {
      if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
    } else if (raw !== '' && !/^\d+$/.test(raw)) {
      return
    }
    setText(raw)
  }

  return (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => {
        if (validateNumericDraft(text, min, max, decimal)) {
          commit()
        } else {
          setText(String(value))
        }
      }}
      className={className}
    />
  )
})
const fieldSelect =
  'w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-white dark:border-gray-600 dark:bg-transparent'
const btnSet = `${btnBase} border-white/25 bg-[#1d1e1e] text-white hover:bg-[#252626]`

type ImageStats = {
  mean: [number, number, number]
  median: [number, number, number]
  stdDev: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  clipBlack: number
  clipWhite: number
  snr: number
}

type HistogramData = { rH: Uint32Array; gH: Uint32Array; bH: Uint32Array }

function channelStats(hist: Uint32Array, totalPixels: number) {
  let sum = 0
  let sumSq = 0
  let mn = 255
  let mx = 0
  for (let i = 0; i < 256; i++) {
    const c = hist[i]
    if (c > 0) {
      sum += i * c
      sumSq += i * i * c
      if (i < mn) mn = i
      if (i > mx) mx = i
    }
  }
  const mean = sum / totalPixels
  const variance = sumSq / totalPixels - mean * mean
  const stdDev = Math.sqrt(Math.max(0, variance))

  let acc = 0
  let median = 0
  const half = totalPixels / 2
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= half) { median = i; break }
  }

  return { mean, median, stdDev, min: mn, max: mx }
}

function analyzeImageData(data: Uint8ClampedArray): { stats: ImageStats; hist: HistogramData } {
  const rH = new Uint32Array(256)
  const gH = new Uint32Array(256)
  const bH = new Uint32Array(256)
  const totalPixels = data.length / 4
  let clipB = 0
  let clipW = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    rH[r]++
    gH[g]++
    bH[b]++
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum <= 0) clipB++
    if (lum >= 255) clipW++
  }
  const rS = channelStats(rH, totalPixels)
  const gS = channelStats(gH, totalPixels)
  const bS = channelStats(bH, totalPixels)
  const overallMean = (rS.mean + gS.mean + bS.mean) / 3
  const overallStd = (rS.stdDev + gS.stdDev + bS.stdDev) / 3
  return {
    stats: {
      mean: [rS.mean, gS.mean, bS.mean],
      median: [rS.median, gS.median, bS.median],
      stdDev: [rS.stdDev, gS.stdDev, bS.stdDev],
      min: [rS.min, gS.min, bS.min],
      max: [rS.max, gS.max, bS.max],
      clipBlack: (clipB / totalPixels) * 100,
      clipWhite: (clipW / totalPixels) * 100,
      snr: overallStd > 0 ? overallMean / overallStd : 0,
    },
    hist: { rH, gH, bH },
  }
}

function StatsHistPanel({
  stats,
  hist,
}: {
  stats: ImageStats | null
  hist: HistogramData | null
}) {
  const histWrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const drawHistogram = useCallback(() => {
    const wrap = histWrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !hist) return

    const cssW = Math.max(1, wrap.clientWidth)
    const cssH = Math.max(1, wrap.clientHeight)
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const { rH, gH, bH } = hist
    let peak = 1
    for (let i = 0; i < 256; i++) {
      if (rH[i] > peak) peak = rH[i]
      if (gH[i] > peak) peak = gH[i]
      if (bH[i] > peak) peak = bH[i]
    }

    const padTop = 4
    const plotH = Math.max(1, cssH - padTop)
    const drawChannel = (h: Uint32Array, color: string) => {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      for (let i = 0; i < 256; i++) {
        const px = (i / 255) * cssW
        const py = padTop + plotH - (h[i] / peak) * plotH
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.globalAlpha = 0.1
      ctx.fillStyle = color
      ctx.lineTo(cssW, cssH)
      ctx.lineTo(0, cssH)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }
    drawChannel(rH, '#ef4444')
    drawChannel(gH, '#22c55e')
    drawChannel(bH, '#3b82f6')
  }, [hist])

  useLayoutEffect(() => {
    drawHistogram()
  }, [drawHistogram])

  useEffect(() => {
    const wrap = histWrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => drawHistogram())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [drawHistogram])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 py-2 font-mono text-xs leading-relaxed">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <p>
            <span className="text-gray-500">Mean </span>
            <span className="text-red-400">{stats ? stats.mean[0].toFixed(1) : '—'}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-green-400">{stats ? stats.mean[1].toFixed(1) : '—'}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-blue-400">{stats ? stats.mean[2].toFixed(1) : '—'}</span>
          </p>
          <p>
            <span className="text-gray-500">Med </span>
            <span className="text-red-400">{stats ? stats.median[0] : '—'}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-green-400">{stats ? stats.median[1] : '—'}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-blue-400">{stats ? stats.median[2] : '—'}</span>
          </p>
          <p>
            <span className="text-gray-500">StdDev </span>
            <span className="text-white">
              {stats ? ((stats.stdDev[0] + stats.stdDev[1] + stats.stdDev[2]) / 3).toFixed(1) : '—'}
            </span>
          </p>
          <p>
            <span className="text-gray-500">SNR </span>
            <span className="text-white">{stats ? stats.snr.toFixed(1) : '—'}</span>
          </p>
          <p>
            <span className="text-gray-500">Min </span>
            <span className="text-white">{stats ? Math.min(...stats.min) : '—'}</span>
            <span className="text-gray-500"> Max </span>
            <span className="text-white">{stats ? Math.max(...stats.max) : '—'}</span>
          </p>
          <p>
            <span className="text-gray-500">Clip </span>
            <span className="text-white">{stats ? `${stats.clipBlack.toFixed(1)}%` : '—'}</span>
            <span className="text-gray-500"> / </span>
            <span className="text-white">{stats ? `${stats.clipWhite.toFixed(1)}%` : '—'}</span>
          </p>
        </div>
      </div>

      <hr className="my-2 shrink-0 border-gray-700" />

      <div ref={histWrapRef} className="min-h-44 w-full flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label="RGB histogram" />
      </div>
    </div>
  )
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-red-400'}`}
    />
  )
}

/** Derive the camera API base URL from the MJPEG stream URL (public domain). */
function camApiBase(streamUrl: string): string {
  try {
    const u = new URL(streamUrl)
    return u.origin
  } catch {
    return ''
  }
}

async function camFetch(
  base: string,
  path: string,
  opts?: RequestInit,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    ...opts,
  })
}

async function camJson<T = unknown>(base: string, path: string, opts?: RequestInit): Promise<T> {
  const res = await camFetch(base, path, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json()
}

export function AllSkyCameraControlPanel() {
  const controller = useAppStore((s) => s.controllers.find((c) => c.roles.includes('cameras')))
  const streamURL = controller?.apiClient?.getStreamURL() ?? ''
  const base = useMemo(() => camApiBase(streamURL), [streamURL])

  const [camStatus, setCamStatus] = useState<CamStatus>({
    connected: false,
    streaming: false,
    mode: 'off',
    autoMode: false,
    lastStreamFrameIso: null,
    lastAutoFrameIso: null,
    fault: null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Settings state
  const [gain, setGain] = useState(50)
  const [gainMax, setGainMax] = useState(DEFAULT_GAIN_MAX)
  const [gamma, setGamma] = useState(50)
  const [videoExposureMs, setVideoExposureMs] = useState(100)
  const [photoExposureS, setPhotoExposureS] = useState(1)
  const [wbR, setWbR] = useState(50)
  const [wbB, setWbB] = useState(50)

  // Stream refresh key — bump to force the MJPEG <img> to reconnect
  const [streamKey, setStreamKey] = useState(() => Date.now())
  const refreshStream = useCallback(() => setStreamKey(Date.now()), [])

  // Sequence
  const [seqCount, setSeqCount] = useState(10)
  const [seqFolderName, setSeqFolderName] = useState('')
  const [seqFileFormat, setSeqFileFormat] = useState('JPEG')
  const [seqInterval, setSeqInterval] = useState(0)
  const [seqStatus, setSeqStatus] = useState<SeqStatus | null>(null)
  const [seqBusy, setSeqBusy] = useState(false)

  const [settingsBusy, setSettingsBusy] = useState(false)

  const gainInputRef = useRef<NumericInputHandle>(null)
  const gammaInputRef = useRef<NumericInputHandle>(null)
  const videoExpInputRef = useRef<NumericInputHandle>(null)
  const photoExpInputRef = useRef<NumericInputHandle>(null)
  const wbRInputRef = useRef<NumericInputHandle>(null)
  const wbBInputRef = useRef<NumericInputHandle>(null)

  const [gainInputValid, setGainInputValid] = useState(true)
  const [gammaInputValid, setGammaInputValid] = useState(true)
  const [videoExpInputValid, setVideoExpInputValid] = useState(true)
  const [photoExpInputValid, setPhotoExpInputValid] = useState(true)
  const [wbRInputValid, setWbRInputValid] = useState(true)
  const [wbBInputValid, setWbBInputValid] = useState(true)

  const seqCountInputRef = useRef<NumericInputHandle>(null)
  const seqIntervalInputRef = useRef<NumericInputHandle>(null)
  const [seqCountInputValid, setSeqCountInputValid] = useState(true)
  const [seqIntervalInputValid, setSeqIntervalInputValid] = useState(true)

  const settingsLoadedRef = useRef(false)

  // Mode is enforced on the Pi (server-side auto continues without this browser tab)
  const [mode, setMode] = useState<CamMode>('off')
  const modeRestoredRef = useRef(false)
  const [imageStats, setImageStats] = useState<ImageStats | null>(null)
  const [histData, setHistData] = useState<HistogramData | null>(null)

  const refreshAutoStats = useCallback(async () => {
    if (!base) return
    try {
      const res = await camFetch(base, '/camera/latest')
      if (!res.ok) return
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      const off = new OffscreenCanvas(bmp.width, bmp.height)
      const octx = off.getContext('2d')!
      octx.drawImage(bmp, 0, 0)
      const { data } = octx.getImageData(0, 0, bmp.width, bmp.height)
      bmp.close()
      const result = analyzeImageData(data)
      setImageStats(result.stats)
      setHistData(result.hist)
    } catch {
      // skip on error
    }
  }, [base])

  // ------------------------------------------------------------------
  // Status polling — uses public cam.pomfretastro.org via camJson
  // ------------------------------------------------------------------
  const pollStatus = useCallback(async () => {
    if (!base) return
    try {
      const data = await camJson<{
        sensors?: {
          allSkyCam?: {
            connected?: boolean
            streaming?: boolean
            mode?: string
            autoMode?: boolean
            lastStreamFrameIso?: string | null
            lastAutoFrameIso?: string | null
            fault?: string | null
            gainMax?: number
          }
        }
      }>(base, '/status')
      const cam = data.sensors?.allSkyCam
      if (cam) {
        if (typeof cam.gainMax === 'number') {
          setGainMax(cam.gainMax)
          setGain((g) => Math.min(cam.gainMax!, Math.max(GAIN_UI_MIN, g)))
        }
        const serverMode: CamMode =
          cam.mode === 'stream' || cam.mode === 'auto' || cam.mode === 'off'
            ? cam.mode
            : cam.autoMode
              ? 'auto'
              : cam.streaming
                ? 'stream'
                : 'off'
        setCamStatus({
          connected: cam.connected ?? false,
          streaming: cam.streaming ?? false,
          mode: serverMode,
          autoMode: cam.autoMode ?? false,
          lastStreamFrameIso: cam.lastStreamFrameIso ?? null,
          lastAutoFrameIso: cam.lastAutoFrameIso ?? null,
          fault: cam.fault ?? null,
        })
        setMode(serverMode)
      }
    } catch {
      // keep previous state on network failure
    }
  }, [base])

  const loadSettings = useCallback(async () => {
    if (!base) return
    try {
      const s = await camJson<{
        gain?: number
        gamma?: number
        photo_exposure?: number
        video_exposure?: number
        gain_max?: number
        wb_r?: number
        wb_b?: number
      }>(base, '/camera/settings')
      if (typeof s.gain === 'number') setGain(s.gain)
      if (typeof s.gamma === 'number') setGamma(s.gamma)
      if (typeof s.wb_r === 'number') setWbR(Math.max(WB_MIN, Math.min(WB_MAX, s.wb_r)))
      if (typeof s.wb_b === 'number') setWbB(Math.max(WB_MIN, Math.min(WB_MAX, s.wb_b)))
      if (typeof s.photo_exposure === 'number') {
        setPhotoExposureS(s.photo_exposure / 1_000_000)
      }
      if (typeof s.video_exposure === 'number') {
        setVideoExposureMs(Math.max(VIDEO_EXP_MIN_MS, Math.round(s.video_exposure / 1000)))
      }
      if (typeof s.gain_max === 'number') setGainMax(s.gain_max)
    } catch {
      // keep previous values on failure
    }
  }, [base])

  useEffect(() => {
    void pollStatus()
    const id = setInterval(() => void pollStatus(), STATUS_POLL_MS)
    return () => clearInterval(id)
  }, [pollStatus])

  useEffect(() => {
    if (!base || !camStatus.connected) {
      settingsLoadedRef.current = false
      return
    }
    if (settingsLoadedRef.current) return
    settingsLoadedRef.current = true
    void loadSettings()
  }, [base, camStatus.connected, loadSettings])

  const switchMode = useCallback(
    async (target: CamMode) => {
      if (!base) return
      setError(null)
      try {
        await camJson<{ success: boolean; message?: string }>(base, '/camera/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: target, interval: 60 }),
        })
        setMode(target)
        writeSavedMode(target)
        await pollStatus()
        if (target === 'stream' || target === 'auto') {
          refreshStream()
        }
        if (target === 'auto') {
          void refreshAutoStats()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Mode change failed')
      }
    },
    [base, pollStatus, refreshStream, refreshAutoStats],
  )

  // Restore mode after refresh when camera is connected
  useEffect(() => {
    if (!base || !camStatus.connected) {
      if (!camStatus.connected) modeRestoredRef.current = false
      return
    }
    if (modeRestoredRef.current) return
    modeRestoredRef.current = true

    const serverMode = camStatus.mode
    if (serverMode === 'stream' || serverMode === 'auto') {
      setMode(serverMode)
      writeSavedMode(serverMode)
      if (serverMode === 'stream' || serverMode === 'auto') refreshStream()
      if (serverMode === 'auto') void refreshAutoStats()
      return
    }

    const saved = readSavedMode()
    if (saved === 'auto' || saved === 'stream') {
      void switchMode(saved)
    } else {
      setMode('off')
    }
  }, [
    base,
    camStatus.connected,
    camStatus.mode,
    switchMode,
    refreshStream,
    refreshAutoStats,
  ])

  // Refresh histogram/stats when server captures a new auto frame
  useEffect(() => {
    if (mode !== 'auto' || !camStatus.lastAutoFrameIso) return
    void refreshAutoStats()
    // MJPEG /camera/stream re-pushes auto frames; no streamKey bump (avoids preview flash).
  }, [mode, camStatus.lastAutoFrameIso, refreshAutoStats])

  // ------------------------------------------------------------------
  // Sequence status polling (only while active)
  // ------------------------------------------------------------------
  const pollSeqStatus = useCallback(async () => {
    if (!base) return true
    try {
      const s = await camJson<SeqStatus>(base, '/camera/sequence/status')
      setSeqStatus(s)
      if (!s.active) return false
    } catch {
      // ignore
    }
    return true
  }, [base])

  useEffect(() => {
    if (!seqStatus?.active) return
    const id = setInterval(async () => {
      const stillActive = await pollSeqStatus()
      if (!stillActive) clearInterval(id)
    }, SEQ_POLL_MS)
    return () => clearInterval(id)
  }, [seqStatus?.active, pollSeqStatus])

  // ------------------------------------------------------------------
  // Actions (all go through public URL)
  // ------------------------------------------------------------------
  const wrap = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
        await pollStatus()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed')
      } finally {
        setBusy(false)
      }
    },
    [pollStatus],
  )

  const connectCamera = () =>
    wrap(async () => {
      await camJson(base, '/camera/connect', { method: 'POST' })
    })
  const disconnectCamera = () =>
    wrap(async () => {
      await camJson(base, '/camera/disconnect', { method: 'POST' })
    })

  // ------------------------------------------------------------------
  // Settings apply (immediate, called on "Set" click)
  // ------------------------------------------------------------------
  const applySettings = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!base) return
      setSettingsBusy(true)
      try {
        const body: Record<string, unknown> = { wb_auto: false, image_format: 'RGB24' }
        if (patch.gain !== undefined) body.gain = patch.gain
        if (patch.gamma !== undefined) body.gamma = patch.gamma
        if (patch.photoExposure !== undefined)
          body.photo_exposure = Math.round((patch.photoExposure as number) * 1_000_000)
        if (patch.videoExposure !== undefined)
          body.video_exposure = Math.round((patch.videoExposure as number) * 1_000_000)
        if (patch.wbR !== undefined) body.wb_r = patch.wbR
        if (patch.wbB !== undefined) body.wb_b = patch.wbB
        await camJson(base, '/camera/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (mode === 'stream') {
          refreshStream()
        } else if (mode === 'auto') {
          // Video exposure only applies to stream mode; auto uses photo exposure.
          const affectsAutoCapture =
            patch.gain !== undefined ||
            patch.gamma !== undefined ||
            patch.photoExposure !== undefined ||
            patch.wbR !== undefined ||
            patch.wbB !== undefined
          if (affectsAutoCapture) {
            void refreshAutoStats()
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Settings update failed')
      } finally {
        setSettingsBusy(false)
      }
    },
    [base, refreshStream, mode, refreshAutoStats],
  )

  // ------------------------------------------------------------------
  // Sequence
  // ------------------------------------------------------------------
  const startSequence = useCallback(async () => {
    if (!base) return
    setSeqBusy(true)
    setError(null)
    try {
      const count = seqCountInputRef.current?.commit() ?? seqCount
      const interval = seqIntervalInputRef.current?.commit() ?? seqInterval
      const body: Record<string, unknown> = {
        count,
        file_format: seqFileFormat,
      }
      if (interval > 0) body.interval = interval
      const folderName = seqFolderName.trim()
      if (folderName) body.folder_name = folderName
      await camJson(base, '/camera/sequence/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await pollSeqStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sequence start failed')
    } finally {
      setSeqBusy(false)
    }
  }, [base, seqFolderName, seqCount, seqFileFormat, seqInterval, pollSeqStatus])

  const stopSequence = useCallback(async () => {
    if (!base) return
    setSeqBusy(true)
    try {
      await camJson(base, '/camera/sequence/stop', { method: 'POST' })
      await pollSeqStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sequence stop failed')
    } finally {
      setSeqBusy(false)
    }
  }, [base, pollSeqStatus])

  // ------------------------------------------------------------------
  // No controller / no stream URL fallback
  // ------------------------------------------------------------------
  if (!controller || !base) {
    return (
      <DashboardPanel title="All Sky Camera Control">
        <p className="text-sm text-gray-500">
          No camera controller configured. Add a controller with the &quot;cameras&quot; role in
          Settings.
        </p>
      </DashboardPanel>
    )
  }

  return (
    <DashboardPanel title="All Sky Camera Control">
      <style dangerouslySetInnerHTML={{ __html: sliderStaticCSS }} />
      <div className="space-y-5">
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {/* ---- Live Preview + Connection & Stream controls ---- */}
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          {/* Stream view — 16:9 sets row height; preview does not stretch with right column */}
          <div className="relative aspect-video w-full self-start overflow-hidden rounded-lg bg-black">
            {mode === 'stream' || mode === 'auto' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={streamKey}
                src={`${streamURL}?t=${streamKey}`}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="text-sm text-gray-500">Off</span>
              </div>
            )}
          </div>

          {/* Same row height as preview; histogram flexes in remaining space */}
          <div className="flex min-h-0 flex-col gap-3 self-stretch">
            {camStatus.connected && (
              <StatsHistPanel stats={imageStats} hist={histData} />
            )}

            {/* Connection + Mode side by side */}
            <div className="grid shrink-0 grid-cols-2 gap-3">
              {/* Connection */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <StatusDot on={camStatus.connected} />
                  <span className="text-sm text-white">
                    {camStatus.connected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={btnSuccess}
                    disabled={busy || camStatus.connected}
                    onClick={() => void connectCamera()}
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy || !camStatus.connected}
                    onClick={() => void disconnectCamera()}
                  >
                    Disconnect
                  </button>
                </div>
                {camStatus.fault && mode === 'stream' && (
                  <p className="text-xs text-red-400">Fault: {camStatus.fault}</p>
                )}
              </div>

              {/* Mode */}
              <div className="space-y-1.5">
                <span className="block text-sm text-white">Mode</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={mode === 'stream' ? btnSuccess : btnPrimary}
                    disabled={busy || !camStatus.connected || mode === 'stream'}
                    onClick={() => void switchMode('stream')}
                  >
                    Stream
                  </button>
                  <button
                    type="button"
                    className={mode === 'auto' ? btnSuccess : btnPrimary}
                    disabled={busy || !camStatus.connected || mode === 'auto'}
                    onClick={() => void switchMode('auto')}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    className={mode === 'off' ? btnDanger : btnPrimary}
                    disabled={busy || mode === 'off'}
                    onClick={() => void switchMode('off')}
                  >
                    Off
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Camera Settings + Sequence Capture side by side ---- */}
        {camStatus.connected && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="boxed-fields space-y-4">
            <p className="text-sm font-medium text-white">Camera Settings</p>

            {/* Gain */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>
                  Gain <span className="text-gray-500">({GAIN_UI_MIN}-{gainMax})</span>
                </span>
                <StyledSlider min={GAIN_UI_MIN} max={gainMax} value={gain} onChange={setGain} />
                <NumericInput
                  ref={gainInputRef}
                  value={gain}
                  onChange={setGain}
                  min={GAIN_UI_MIN}
                  max={gainMax}
                  onValidityChange={setGainInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !gainInputValid}
                  onClick={() =>
                    void applySettings({ gain: gainInputRef.current?.commit() ?? gain })
                  }
                >
                  Set
                </button>
              </div>
            </div>

            {/* Gamma */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>Gamma</span>
                <StyledSlider min={1} max={100} value={gamma} onChange={setGamma} />
                <NumericInput
                  ref={gammaInputRef}
                  value={gamma}
                  onChange={setGamma}
                  min={1}
                  max={100}
                  onValidityChange={setGammaInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !gammaInputValid}
                  onClick={() =>
                    void applySettings({ gamma: gammaInputRef.current?.commit() ?? gamma })
                  }
                >
                  Set
                </button>
              </div>
            </div>

            {/* Video Exposure */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>Video Exp (ms)</span>
                <StyledSlider
                  min={VIDEO_EXP_MIN_MS}
                  max={VIDEO_EXP_MAX_MS}
                  step={1}
                  value={videoExposureMs}
                  onChange={setVideoExposureMs}
                />
                <NumericInput
                  ref={videoExpInputRef}
                  value={videoExposureMs}
                  onChange={setVideoExposureMs}
                  min={VIDEO_EXP_MIN_MS}
                  max={VIDEO_EXP_MAX_MS}
                  onValidityChange={setVideoExpInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !videoExpInputValid}
                  onClick={() => {
                    const ms = videoExpInputRef.current?.commit() ?? videoExposureMs
                    void applySettings({ videoExposure: ms / 1000 })
                  }}
                >
                  Set
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>Photo Exp (s)</span>
                <StyledSlider
                  min={0}
                  max={PHOTO_EXP_SLIDER_STEPS}
                  step={1}
                  value={photoExposureToSlider(photoExposureS)}
                  onChange={(pos) => setPhotoExposureS(sliderToPhotoExposure(pos))}
                />
                <NumericInput
                  ref={photoExpInputRef}
                  value={photoExposureS}
                  onChange={setPhotoExposureS}
                  min={PHOTO_EXP_MIN_S}
                  max={PHOTO_EXP_MAX_S}
                  decimal
                  onValidityChange={setPhotoExpInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !photoExpInputValid}
                  onClick={() =>
                    void applySettings({
                      photoExposure: photoExpInputRef.current?.commit() ?? photoExposureS,
                    })
                  }
                >
                  Set
                </button>
              </div>
            </div>

            {/* WB R */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>
                  WB R <span className="text-gray-500">({WB_MIN}-{WB_MAX})</span>
                </span>
                <StyledSlider min={WB_MIN} max={WB_MAX} value={wbR} onChange={setWbR} />
                <NumericInput
                  ref={wbRInputRef}
                  value={wbR}
                  onChange={setWbR}
                  min={WB_MIN}
                  max={WB_MAX}
                  onValidityChange={setWbRInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !wbRInputValid}
                  onClick={() =>
                    void applySettings({ wbR: wbRInputRef.current?.commit() ?? wbR })
                  }
                >
                  Set
                </button>
              </div>
            </div>

            {/* WB B */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>
                  WB B <span className="text-gray-500">({WB_MIN}-{WB_MAX})</span>
                </span>
                <StyledSlider min={WB_MIN} max={WB_MAX} value={wbB} onChange={setWbB} />
                <NumericInput
                  ref={wbBInputRef}
                  value={wbB}
                  onChange={setWbB}
                  min={WB_MIN}
                  max={WB_MAX}
                  onValidityChange={setWbBInputValid}
                  className={fieldInputCompact}
                />
                <button
                  type="button"
                  className={btnSet}
                  disabled={settingsBusy || !wbBInputValid}
                  onClick={() =>
                    void applySettings({ wbB: wbBInputRef.current?.commit() ?? wbB })
                  }
                >
                  Set
                </button>
              </div>
            </div>

            </div>

            {/* Right column: Sequence Capture */}
            <div className="space-y-6">
              <div className="boxed-fields space-y-3">
                <p className="text-sm font-medium text-white">Sequence Capture</p>

            {seqStatus?.active ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">
                    Capturing {seqStatus.current_count} / {seqStatus.total_count}
                  </span>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={seqBusy}
                    onClick={() => void stopSequence()}
                  >
                    Stop
                  </button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${seqStatus.total_count > 0 ? (seqStatus.current_count / seqStatus.total_count) * 100 : 0}%`,
                    }}
                  />
                </div>
                {seqStatus.folder_name && (
                  <p className="text-xs text-gray-500">
                    Drive folder:{' '}
                    {seqStatus.drive_url ? (
                      <a
                        href={seqStatus.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline hover:text-blue-300"
                      >
                        {seqStatus.folder_name}
                      </a>
                    ) : (
                      seqStatus.folder_name
                    )}
                  </p>
                )}
                {seqStatus.last_error && (
                  <p className="text-xs text-red-400">Upload error: {seqStatus.last_error}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`${labelClass} w-28 shrink-0`}>Count</span>
                    <StyledSlider
                      min={SEQ_COUNT_MIN}
                      max={SEQ_COUNT_SLIDER_MAX}
                      step={1}
                      value={Math.min(seqCount, SEQ_COUNT_SLIDER_MAX)}
                      onChange={setSeqCount}
                    />
                    <NumericInput
                      ref={seqCountInputRef}
                      value={seqCount}
                      onChange={setSeqCount}
                      min={SEQ_COUNT_MIN}
                      max={SEQ_COUNT_MAX}
                      onValidityChange={setSeqCountInputValid}
                      className={fieldInputCompact}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`${labelClass} w-28 shrink-0`}>Interval (s)</span>
                    <StyledSlider
                      min={SEQ_INTERVAL_MIN}
                      max={SEQ_INTERVAL_MAX}
                      step={1}
                      value={seqInterval}
                      onChange={setSeqInterval}
                    />
                    <NumericInput
                      ref={seqIntervalInputRef}
                      value={seqInterval}
                      onChange={setSeqInterval}
                      min={SEQ_INTERVAL_MIN}
                      max={SEQ_INTERVAL_MAX}
                      onValidityChange={setSeqIntervalInputValid}
                      className={fieldInputCompact}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Uploads to{' '}
                  <a
                    href={DRIVE_SEQUENCE_ROOT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline hover:text-blue-300"
                  >
                    All Sky Camera (Google Drive)
                  </a>
                  . Each run creates a subfolder (no files stored on the Pi).
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className={labelClass}>Folder name (optional)</span>
                    <input
                      type="text"
                      value={seqFolderName}
                      onChange={(e) => setSeqFolderName(e.target.value)}
                      placeholder="Auto: date_time x count"
                      className={fieldInput}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className={labelClass}>File Format</span>
                    <select
                      value={seqFileFormat}
                      onChange={(e) => setSeqFileFormat(e.target.value)}
                      className={fieldSelect}
                    >
                      <option value="JPEG">JPEG</option>
                      <option value="PNG">PNG</option>
                      <option value="TIFF">TIFF</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={seqBusy || !seqCountInputValid || !seqIntervalInputValid}
                  onClick={() => void startSequence()}
                >
                  {seqBusy ? 'Starting…' : 'Start Sequence'}
                </button>
              </div>
            )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardPanel>
  )
}
