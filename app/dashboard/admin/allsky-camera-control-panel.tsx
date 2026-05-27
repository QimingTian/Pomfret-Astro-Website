'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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

type SeqStatus = {
  active: boolean
  current_count: number
  total_count: number
  save_path?: string
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

/** ASI662MC gain range; updated from /status when camera is connected. */
const DEFAULT_GAIN_MIN = 0
const DEFAULT_GAIN_MAX = 500

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
  active,
}: {
  stats: ImageStats | null
  hist: HistogramData | null
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !hist) return
    const { rH, gH, bH } = hist
    let peak = 1
    for (let i = 0; i < 256; i++) {
      if (rH[i] > peak) peak = rH[i]
      if (gH[i] > peak) peak = gH[i]
      if (bH[i] > peak) peak = bH[i]
    }
    const W = canvas.width
    const H = canvas.height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)

    const drawChannel = (h: Uint32Array, color: string) => {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      for (let x = 0; x < 256; x++) {
        const px = (x / 255) * W
        const py = H - (h[x] / peak) * H
        if (x === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.globalAlpha = 0.08
      ctx.fillStyle = color
      ctx.lineTo(W, H)
      ctx.lineTo(0, H)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }
    drawChannel(rH, '#ef4444')
    drawChannel(gH, '#22c55e')
    drawChannel(bH, '#3b82f6')
  }, [hist])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 font-mono text-[0.6rem] leading-relaxed">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
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
        {!stats && (
          <p className="mt-1 text-[0.55rem] text-gray-600">
            {active ? 'Waiting for data…' : 'Auto mode only'}
          </p>
        )}
      </div>

      <hr className="my-2 shrink-0 border-gray-700" />

      <div className="flex min-h-0 flex-1 flex-col">
        <canvas ref={canvasRef} width={256} height={128} className="min-h-0 w-full flex-1" />
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
  const [gainMin, setGainMin] = useState(DEFAULT_GAIN_MIN)
  const [gainMax, setGainMax] = useState(DEFAULT_GAIN_MAX)
  const [gamma, setGamma] = useState(50)
  const [videoExposureMs, setVideoExposureMs] = useState(100)
  const [photoExposureS, setPhotoExposureS] = useState(1)

  // Stream refresh key — bump to force the MJPEG <img> to reconnect
  const [streamKey, setStreamKey] = useState(() => Date.now())
  const refreshStream = useCallback(() => setStreamKey(Date.now()), [])

  // Snapshot
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)

  // Sequence
  const [seqCount, setSeqCount] = useState(10)
  const [seqSavePath, setSeqSavePath] = useState('~/captures')
  const [seqFileFormat, setSeqFileFormat] = useState('JPEG')
  const [seqInterval, setSeqInterval] = useState(0)
  const [seqStatus, setSeqStatus] = useState<SeqStatus | null>(null)
  const [seqBusy, setSeqBusy] = useState(false)

  const [settingsBusy, setSettingsBusy] = useState(false)

  const gainInputRef = useRef<NumericInputHandle>(null)
  const gammaInputRef = useRef<NumericInputHandle>(null)
  const videoExpInputRef = useRef<NumericInputHandle>(null)
  const photoExpInputRef = useRef<NumericInputHandle>(null)

  const [gainInputValid, setGainInputValid] = useState(true)
  const [gammaInputValid, setGammaInputValid] = useState(true)
  const [videoExpInputValid, setVideoExpInputValid] = useState(true)
  const [photoExpInputValid, setPhotoExpInputValid] = useState(true)

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
            gainMin?: number
            gainMax?: number
          }
        }
      }>(base, '/status')
      const cam = data.sensors?.allSkyCam
      if (cam) {
        if (typeof cam.gainMin === 'number') {
          setGainMin(cam.gainMin)
          setGain((g) => Math.max(cam.gainMin!, g))
        }
        if (typeof cam.gainMax === 'number') {
          setGainMax(cam.gainMax)
          setGain((g) => Math.min(cam.gainMax!, g))
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
        gain_min?: number
        gain_max?: number
      }>(base, '/camera/settings')
      if (typeof s.gain === 'number') setGain(s.gain)
      if (typeof s.gamma === 'number') setGamma(s.gamma)
      if (typeof s.photo_exposure === 'number') {
        setPhotoExposureS(s.photo_exposure / 1_000_000)
      }
      if (typeof s.video_exposure === 'number') {
        setVideoExposureMs(Math.round(s.video_exposure / 1000))
      }
      if (typeof s.gain_min === 'number') setGainMin(s.gain_min)
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
        const body: Record<string, unknown> = { wb_auto: true, image_format: 'RGB24' }
        if (patch.gain !== undefined) body.gain = patch.gain
        if (patch.gamma !== undefined) body.gamma = patch.gamma
        if (patch.photoExposure !== undefined)
          body.photo_exposure = Math.round((patch.photoExposure as number) * 1_000_000)
        if (patch.videoExposure !== undefined)
          body.video_exposure = Math.round((patch.videoExposure as number) * 1_000_000)
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
            patch.photoExposure !== undefined
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
  // Snapshot
  // ------------------------------------------------------------------
  const takeSnapshot = useCallback(async () => {
    if (!base) return
    setSnapshotBusy(true)
    setError(null)
    try {
      const res = await camFetch(base, '/camera/snapshot')
      if (!res.ok) throw new Error(`Snapshot failed: HTTP ${res.status}`)
      const blob = await res.blob()
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl)
      setSnapshotUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Snapshot failed')
    } finally {
      setSnapshotBusy(false)
    }
  }, [base, snapshotUrl])

  useEffect(() => {
    return () => {
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl)
    }
  }, [snapshotUrl])

  // ------------------------------------------------------------------
  // Sequence
  // ------------------------------------------------------------------
  const startSequence = useCallback(async () => {
    if (!base) return
    setSeqBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        save_path: seqSavePath,
        count: seqCount,
        file_format: seqFileFormat,
      }
      if (seqInterval > 0) body.interval = seqInterval
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
  }, [base, seqSavePath, seqCount, seqFileFormat, seqInterval, pollSeqStatus])

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
        <div className="flex gap-4">
          {/* Stream view */}
          <div className="w-2/3 shrink-0 overflow-hidden rounded-lg bg-black">
            {mode === 'stream' || mode === 'auto' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={streamKey} src={`${streamURL}?t=${streamKey}`} alt="" className="block w-full" />
            ) : (
              <div className="flex aspect-video items-center justify-center">
                <span className="text-sm text-gray-500">Off</span>
              </div>
            )}
          </div>

          {/* Histogram + Status & controls */}
          <div className="flex flex-1 flex-col gap-3">
            {camStatus.connected && (
              <StatsHistPanel
                stats={imageStats}
                hist={histData}
                active={mode === 'auto'}
              />
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

        {/* ---- Camera Settings + Snapshot/Sequence side by side ---- */}
        {camStatus.connected && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="boxed-fields space-y-4">
            <p className="text-sm font-medium text-white">Camera Settings</p>

            {/* Gain */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>Gain</span>
                <StyledSlider min={gainMin} max={gainMax} value={gain} onChange={setGain} />
                <NumericInput
                  ref={gainInputRef}
                  value={gain}
                  onChange={setGain}
                  min={gainMin}
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
                <StyledSlider min={1} max={2000} step={1} value={videoExposureMs} onChange={setVideoExposureMs} />
                <NumericInput
                  ref={videoExpInputRef}
                  value={videoExposureMs}
                  onChange={setVideoExposureMs}
                  min={1}
                  max={2000}
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

            {/* Photo Exposure */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`${labelClass} w-28 shrink-0`}>Photo Exp (s)</span>
                <NumericInput
                  ref={photoExpInputRef}
                  value={photoExposureS}
                  onChange={setPhotoExposureS}
                  min={0.001}
                  max={300}
                  decimal
                  onValidityChange={setPhotoExpInputValid}
                  className={`${fieldInput} flex-1 text-center`}
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

            </div>

            {/* Right column: Snapshot + Sequence Capture */}
            <div className="space-y-6">
              {/* Snapshot */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Snapshot</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={snapshotBusy}
                    onClick={() => void takeSnapshot()}
                  >
                    {snapshotBusy ? 'Capturing…' : 'Take Snapshot'}
                  </button>
                  {snapshotUrl && (
                    <a
                      href={snapshotUrl}
                      download="snapshot.jpg"
                      className={`${btnBase} border-gray-600 text-gray-300 hover:text-white`}
                    >
                      Download
                    </a>
                  )}
                </div>
                {snapshotUrl && (
                  <div className="relative h-48 w-full overflow-hidden rounded-lg bg-black sm:h-64">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={snapshotUrl}
                      alt="Snapshot"
                      className="h-full w-full object-contain"
                    />
                  </div>
                )}
              </div>

              {/* Sequence Capture */}
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
                {seqStatus.save_path && (
                  <p className="text-xs text-gray-500">
                    Saving to: {seqStatus.save_path}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className={labelClass}>Count</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={seqCount}
                      onChange={(e) => setSeqCount(Math.max(1, Number(e.target.value)))}
                      className={fieldInput}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className={labelClass}>Interval (s, 0 = fast)</span>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      step={1}
                      value={seqInterval}
                      onChange={(e) => setSeqInterval(Math.max(0, Number(e.target.value)))}
                      className={fieldInput}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className={labelClass}>Save Path (on Pi)</span>
                    <input
                      type="text"
                      value={seqSavePath}
                      onChange={(e) => setSeqSavePath(e.target.value)}
                      placeholder="~/captures"
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
                  disabled={seqBusy || !seqSavePath.trim()}
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
