'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const POMFRET_LATITUDE = 41.9159
const POMFRET_LONGITUDE = -71.9626
const POMFRET_ALTITUDE_METERS = 150

type MountSample = {
  connected?: boolean
  raHours?: number | null
  decDeg?: number | null
  altitudeDeg?: number | null
  azimuthDeg?: number | null
  trackingEnabled?: boolean | null
  slewing?: boolean | null
  receivedAtUtc?: string | null
  sideOfPier?: string | null
}

type QueueItem = {
  id: string
  target: string
  raHours: number | null
  decDeg: number | null
  status: string
  sessionType?: string
}

type WeatherPrediction = {
  ok: boolean
  prediction?: 'permitted' | 'not_permitted' | 'unavailable'
  nightHourStartsSec?: number[]
  readyHourStartsSec?: number[]
  notPermittedHourReasons?: Array<{ hourStartSec: number; reasons: Array<'cloud' | 'rain' | 'wind'> }>
}

type StelLike = {
  core?: {
    observer?: { yaw?: number; pitch?: number; utc?: number }
    fov?: number
    lock?: unknown
    selection?: unknown
  }
  convertFrame?: (observer: unknown, from: string, to: string, v: number[]) => number[]
  pointAndLock?: (obj: unknown, smoothDurationSec?: number) => void
  getObj?: (name: string) => unknown
  a2af?: (v: number) => unknown
  a2tf?: (v: number) => unknown
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180
}
function radToDeg(r: number): number {
  return (r * 180) / Math.PI
}
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function queueStatusLabel(status: string): string {
  if (status === 'pending') return 'Pending'
  if (status === 'scheduled') return 'Scheduled'
  if (status === 'in_progress' || status === 'claimed') return 'In progress'
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  return status
}

function formatHourMinute(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function raHoursToSexagesimal(raHours: number): string {
  const h = Math.floor(raHours)
  const mFloat = (raHours - h) * 60
  const m = Math.floor(mFloat)
  const s = Math.round((mFloat - m) * 60)
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

function decDegToSexagesimal(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+'
  const abs = Math.abs(decDeg)
  const d = Math.floor(abs)
  const mFloat = (abs - d) * 60
  const m = Math.floor(mFloat)
  const s = Math.round((mFloat - m) * 60)
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`
}

/** Drive the iframe: center view on alt/az (observed frame). */
function centerOnAltAz(stel: StelLike | null, altDeg: number, azDeg: number) {
  const observer = stel?.core?.observer
  if (!observer) return
  if (stel?.core) (stel.core as { lock?: unknown }).lock = 0
  observer.yaw = degToRad(azDeg)
  observer.pitch = degToRad(altDeg)
}

/** Center on RA/Dec (ICRF/J2000). Uses stel.convertFrame to get observed alt/az. */
function centerOnRaDec(stel: StelLike | null, raHours: number, decDeg: number) {
  const observer = stel?.core?.observer
  if (!observer || !stel?.convertFrame) return
  const ra = degToRad(raHours * 15)
  const dec = degToRad(decDeg)
  const x = Math.cos(dec) * Math.cos(ra)
  const y = Math.cos(dec) * Math.sin(ra)
  const z = Math.sin(dec)
  const observed = stel.convertFrame(observer, 'ICRF', 'OBSERVED', [x, y, z, 0])
  if (!observed || observed.length < 3) return
  const [ox, oy, oz] = observed
  const horiz = Math.sqrt(ox * ox + oy * oy)
  const az = Math.atan2(oy, ox)
  const alt = Math.atan2(oz, horiz)
  if (stel.core) (stel.core as { lock?: unknown }).lock = 0
  observer.yaw = az
  observer.pitch = alt
}

function usePolling<T>(fn: () => Promise<T | null>, intervalMs: number): T | null {
  const [state, setState] = useState<T | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const v = await fn()
        if (!cancelled) setState(v)
      } catch {
        if (!cancelled) setState(null)
      }
    }
    void load()
    const id = window.setInterval(load, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])
  return state
}

export default function AtlasPage() {
  const router = useRouter()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [stelReady, setStelReady] = useState(false)
  const [viewerSrc, setViewerSrc] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({
      lat: String(POMFRET_LATITUDE),
      lng: String(POMFRET_LONGITUDE),
      elev: String(POMFRET_ALTITUDE_METERS),
      // Stellarium Web defaults to “time after sunset” until location is set; `date` locks sim time to now
      // so parent ribbon / wall clock align with reality (see App.vue setStateFromQueryArgs + startTimeIsSet).
      date: new Date().toISOString(),
    })
    setStelReady(false)
    setViewerSrc(`/stellarium/index.html?${params.toString()}`)
  }, [])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev?.data && typeof ev.data === 'object' && ev.data.source === 'pomfret-stellarium' && ev.data.type === 'ready') {
        setStelReady(true)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const getStel = useCallback((): StelLike | null => {
    const iframe = iframeRef.current
    if (!iframe) return null
    const win = iframe.contentWindow as (Window & { stel?: StelLike }) | null
    return win?.stel ?? null
  }, [])

  const mount = usePolling<MountSample | null>(async () => {
    const res = await fetch(`/api/imaging/mount-pointing?_=${Date.now()}`, { cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; sample?: MountSample | null } | null
    if (!data?.ok) return null
    return data.sample ?? null
  }, 3000)

  const queue = usePolling<QueueItem[]>(async () => {
    const res = await fetch(`/api/imaging/queue?_=${Date.now()}`, { cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; requests?: QueueItem[] } | null
    if (!data?.ok) return []
    const now = data.requests ?? []
    return now.filter((r) => r.status === 'pending' || r.status === 'scheduled' || r.status === 'in_progress' || r.status === 'claimed')
  }, 10_000)

  const weather = usePolling<WeatherPrediction | null>(async () => {
    const res = await fetch(`/api/imaging/tonight-weather-prediction?_=${Date.now()}`, { cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as WeatherPrediction | null
    return data
  }, 60_000)

  const mountConnected = !!mount?.connected
  const mountAltDeg = finiteOrNull(mount?.altitudeDeg ?? null)
  const mountAzDeg = finiteOrNull(mount?.azimuthDeg ?? null)
  const mountRaHours = finiteOrNull(mount?.raHours ?? null)
  const mountDecDeg = finiteOrNull(mount?.decDeg ?? null)

  const handleCenterOnMount = () => {
    const stel = getStel()
    if (!stel) return
    if (mountAltDeg != null && mountAzDeg != null) {
      centerOnAltAz(stel, mountAltDeg, mountAzDeg)
    } else if (mountRaHours != null && mountDecDeg != null) {
      centerOnRaDec(stel, mountRaHours, mountDecDeg)
    }
  }

  const handleLocateTarget = (item: QueueItem) => {
    const stel = getStel()
    if (!stel) return
    if (item.raHours != null && item.decDeg != null) {
      centerOnRaDec(stel, item.raHours, item.decDeg)
      return
    }
    if (stel.getObj && stel.pointAndLock) {
      const obj = stel.getObj(item.target)
      if (obj) stel.pointAndLock(obj, 2)
    }
  }

  const handleSendQueueItemToRemote = (item: QueueItem) => {
    const params = new URLSearchParams()
    if (item.target) params.set('prefillTarget', item.target)
    if (item.raHours != null) params.set('prefillRa', String(item.raHours))
    if (item.decDeg != null) params.set('prefillDec', String(item.decDeg))
    router.push(`/dashboard/remote?${params.toString()}`)
  }

  const nightStartSec = weather?.nightHourStartsSec?.[0]
  const nightEndSec =
    weather?.nightHourStartsSec && weather.nightHourStartsSec.length > 0
      ? (weather.nightHourStartsSec[weather.nightHourStartsSec.length - 1] as number) + 3600
      : undefined
  const readySet = useMemo(() => new Set(weather?.readyHourStartsSec ?? []), [weather?.readyHourStartsSec])

  const handleRibbonClick = (ev: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    if (!nightStartSec || !nightEndSec) return
    const stel = getStel()
    const observer = stel?.core?.observer
    if (!observer) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const clientX = 'clientX' in ev ? ev.clientX : rect.left + rect.width / 2
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const whenSec = nightStartSec + frac * (nightEndSec - nightStartSec)
    const mjd = whenSec / 86400 + 2440587.5 - 2400000.5
    observer.utc = mjd
  }

  const handleSendSelectionToRemote = () => {
    const stel = getStel() as (StelLike & { core?: { selection?: unknown } }) | null
    const selection = stel?.core?.selection as { names?: string[]; getInfo?: (s: string) => unknown } | undefined
    if (!selection) return
    const name = Array.isArray(selection.names) ? selection.names[0] : undefined
    const radec = typeof selection.getInfo === 'function' ? (selection.getInfo('radec') as number[] | undefined) : undefined
    const params = new URLSearchParams()
    if (name) params.set('prefillTarget', String(name).replace(/^NAME\s+/, ''))
    if (radec && radec.length >= 3) {
      const raRad = Math.atan2(radec[1], radec[0])
      const raHours = ((radToDeg(raRad) + 360) % 360) / 15
      const decRad = Math.atan2(radec[2], Math.sqrt(radec[0] ** 2 + radec[1] ** 2))
      const decDeg = radToDeg(decRad)
      params.set('prefillRa', raHours.toFixed(5))
      params.set('prefillDec', decDeg.toFixed(4))
    }
    router.push(`/dashboard/remote?${params.toString()}`)
  }

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Atlas</h1>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Interactive sky atlas centered on Pomfret Observatory ({POMFRET_LATITUDE.toFixed(4)}°,{' '}
          {POMFRET_LONGITUDE.toFixed(4)}°). Live telescope pointing, queued targets, and tonight&apos;s
          observing window are overlaid on a self-hosted Stellarium Web build; star catalogs load from{' '}
          <code className="rounded bg-black/5 px-1 dark:bg-white/10">/skydata</code> (same-origin as the site).
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Avoid overflow-hidden on the iframe wrapper: rounded + clip can blank WebGL in nested iframes on some GPUs. Clip on the iframe element instead. */}
          <div className="relative rounded-xl border border-black/10 dark:border-white/10 bg-black">
            <iframe
              ref={iframeRef}
              src={viewerSrc ?? undefined}
              title="Stellarium sky atlas"
              onLoad={(e) => {
                setViewerReady(true)
                const w = e.currentTarget.contentWindow
                if (!w) return
                const nudge = () => {
                  try {
                    w.dispatchEvent(new Event('resize'))
                  } catch {
                    /* ignore */
                  }
                }
                nudge()
                window.setTimeout(nudge, 100)
                window.setTimeout(nudge, 500)
                window.setTimeout(nudge, 1500)
              }}
              className="block h-[72vh] min-h-[520px] w-full overflow-hidden rounded-xl"
              allow="accelerometer; autoplay; fullscreen; gyroscope; microphone; xr-spatial-tracking"
            />
            {!viewerReady && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">
                Loading sky viewer…
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4 text-sm">
            <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-white">Mount</h2>
                <span className={mountConnected ? 'text-xs font-semibold text-green-400' : 'text-xs font-semibold text-red-400'}>
                  {mountConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-gray-400">RA</dt>
                <dd className="text-gray-200 font-mono">
                  {mountRaHours != null ? raHoursToSexagesimal(mountRaHours) : '—'}
                </dd>
                <dt className="text-gray-400">Dec</dt>
                <dd className="text-gray-200 font-mono">
                  {mountDecDeg != null ? decDegToSexagesimal(mountDecDeg) : '—'}
                </dd>
                <dt className="text-gray-400">Alt</dt>
                <dd className="text-gray-200 font-mono">{mountAltDeg != null ? `${mountAltDeg.toFixed(2)}°` : '—'}</dd>
                <dt className="text-gray-400">Az</dt>
                <dd className="text-gray-200 font-mono">{mountAzDeg != null ? `${mountAzDeg.toFixed(2)}°` : '—'}</dd>
                <dt className="text-gray-400">Tracking</dt>
                <dd className={mount?.trackingEnabled ? 'text-green-400' : 'text-gray-400'}>
                  {mount?.trackingEnabled == null ? '—' : mount.trackingEnabled ? 'On' : 'Off'}
                </dd>
              </dl>
              <button
                type="button"
                onClick={handleCenterOnMount}
                disabled={!stelReady || (mountAltDeg == null && mountRaHours == null)}
                className="mt-3 w-full rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Center sky on mount
              </button>
            </section>

            <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 font-semibold text-white">Queue targets</h2>
              {!queue || queue.length === 0 ? (
                <p className="text-xs text-gray-500">No active sessions.</p>
              ) : (
                <ul className="space-y-2">
                  {queue.map((item) => (
                    <li key={item.id} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-white">{item.target}</p>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500">
                            {queueStatusLabel(item.status)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleLocateTarget(item)}
                          disabled={!stelReady}
                          className="rounded-full border border-white/25 bg-[#151616] px-2.5 py-1 text-[11px] text-white hover:bg-[#1b1c1c] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Locate
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendQueueItemToRemote(item)}
                          className="rounded-full border border-white/25 bg-[#151616] px-2.5 py-1 text-[11px] text-white hover:bg-[#1b1c1c]"
                        >
                          Use in Remote
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white/5 p-4">
              <h2 className="mb-2 font-semibold text-white">Selected object</h2>
              <p className="mb-3 text-xs text-gray-500">
                Tap anything in the sky, then send it straight into a new imaging session.
              </p>
              <button
                type="button"
                onClick={handleSendSelectionToRemote}
                disabled={!stelReady}
                className="w-full rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Use selected in Remote
              </button>
            </section>
          </aside>
        </div>

        <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">Tonight&apos;s observing window</h2>
            <p className="text-[11px] text-gray-500">
              Green = astro-dark + weather permitted · red = not permitted · click to time-travel the sky
            </p>
          </div>
          {!nightStartSec || !nightEndSec ? (
            <p className="text-xs text-gray-500">Weather forecast unavailable.</p>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={handleRibbonClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleRibbonClick(e)
              }}
              className="relative h-10 w-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-black/40"
            >
              {weather?.nightHourStartsSec?.map((sec) => {
                const frac = (sec - nightStartSec) / (nightEndSec - nightStartSec)
                const width = 3600 / (nightEndSec - nightStartSec)
                const ok = readySet.has(sec)
                return (
                  <div
                    key={sec}
                    title={`${formatHourMinute(sec)} — ${ok ? 'permitted' : 'not permitted'}`}
                    className={`absolute top-0 bottom-0 ${ok ? 'bg-emerald-500/50' : 'bg-rose-600/50'}`}
                    style={{ left: `${frac * 100}%`, width: `${width * 100}%` }}
                  />
                )
              })}
              {weather?.nightHourStartsSec?.map((sec) => {
                const frac = (sec - nightStartSec) / (nightEndSec - nightStartSec)
                if (frac <= 0) return null
                return (
                  <div
                    key={`tick-${sec}`}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/15"
                    style={{ left: `${frac * 100}%` }}
                  />
                )
              })}
              <div className="pointer-events-none absolute inset-x-2 top-1 flex justify-between text-[10px] uppercase tracking-wide text-white/60">
                <span>{formatHourMinute(nightStartSec)}</span>
                <span>{formatHourMinute(nightEndSec)}</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
