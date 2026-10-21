'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import AllSkyCameraView from '@/components/AllSkyCameraView'
import { TelescopeStatusPanel } from '@/app/dashboard/remote/telescope-status-panel'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import { useMember } from '@/hooks/use-member'
import { useAdaptivePoll } from '@/hooks/use-adaptive-poll'
import { siteHasAllSkyCamera } from '@/lib/admin-site-access'
import { formatRaDecPair } from '@/lib/format-radec'
import { formatDurationShort } from '@/lib/remote/format'
import { isSessionFailedTerminalLine, queueStatusLabel } from '@/lib/remote/queue-status'
import { queueStatusBadgeClass } from '@/lib/remote/ui-status'
import { nightDisplayLabel } from '@/lib/remote/night-label'
import { skyCoordsForMosaicPanel } from '@/lib/imaging/project/panel-coords'
import {
  formatVariableStarImagingPlan,
  variableStarMonitorUntilMs,
} from '@/lib/imaging/nina/variable-star-plan-label'
import {
  recalledSessionPassword,
  rememberSessionPassword,
} from '@/lib/remote/session-password-store'
import { MonitorWeatherPane } from '@/components/remote/monitor-weather-pane'
import { NightModeToggle } from '@/components/night-mode-toggle'

const LibreWxrRadarMap = dynamic(() => import('@/components/LibreWxrRadarMap'), { ssr: false })
import { glassPillSm } from '@/lib/glass-ui'
import type { RemoteModalQueueItem, SessionProgressLine } from '@/components/remote/remote-modals'

type QueueRow = RemoteModalQueueItem

function progressLinesEqual(a: SessionProgressLine[], b: SessionProgressLine[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].at !== b[i].at || a[i].text !== b[i].text) return false
  }
  return true
}

const DEMO_SESSION_ID = 'demo-ngc7000'
const DEMO_PREVIEW_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
    <defs>
      <radialGradient id="g" cx="48%" cy="42%" r="55%">
        <stop offset="0%" stop-color="#7a4b7a"/>
        <stop offset="35%" stop-color="#2a1840"/>
        <stop offset="100%" stop-color="#05060a"/>
      </radialGradient>
    </defs>
    <rect width="640" height="480" fill="#05060a"/>
    <rect width="640" height="480" fill="url(#g)"/>
    <circle cx="120" cy="80" r="1.2" fill="#fff"/>
    <circle cx="300" cy="50" r="1" fill="#dbe7ff"/>
    <circle cx="510" cy="110" r="1.4" fill="#fff"/>
    <circle cx="80" cy="240" r="0.9" fill="#c9d4ff"/>
    <circle cx="430" cy="300" r="1.1" fill="#fff"/>
    <circle cx="560" cy="400" r="1.3" fill="#eef"/>
    <circle cx="200" cy="390" r="0.8" fill="#fff"/>
    <ellipse cx="310" cy="210" rx="140" ry="70" fill="#c45c4a" opacity="0.35"/>
    <ellipse cx="300" cy="205" rx="70" ry="28" fill="#f2c9a0" opacity="0.25"/>
  </svg>`
)
const DEMO_PREVIEW_URL = `data:image/svg+xml;charset=utf-8,${DEMO_PREVIEW_SVG}`

const DEMO_DETAIL: QueueRow = {
  id: DEMO_SESSION_ID,
  target: 'NGC 7000 North America',
  createdAt: '2026-10-20T02:12:00.000Z',
  status: 'in_progress',
  firstName: 'Avery',
  lastName: 'Chen',
  email: 'avery@pomfret.org',
  raHours: 20.981,
  decDeg: 44.53,
  outputMode: 'raw_zip',
  estimatedDurationSeconds: 4 * 3600,
  sessionType: 'dso',
  filterPlans: [
    { filterName: 'H', exposureSeconds: 300, count: 24 },
    { filterName: 'O', exposureSeconds: 300, count: 16 },
    { filterName: 'S', exposureSeconds: 300, count: 12 },
  ],
}

function demoLines(now = Date.now()): SessionProgressLine[] {
  const t = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString()
  return [
    { at: t(48), text: 'Sequence started · NGC 7000 North America' },
    { at: t(46), text: 'Unpark / slew complete. Settling…' },
    { at: t(44), text: 'Auto-focus H 3.2s · HFR 1.86' },
    { at: t(38), text: 'Image #6/24  H  300s  ADU 18420' },
    { at: t(32), text: 'Image #7/24  H  300s  ADU 18110' },
    { at: t(26), text: 'Image #8/24  H  300s  ADU 18602' },
    { at: t(21), text: 'Meridian flip · 10 min buffer' },
    { at: t(11), text: 'Tracking resumed west of pier' },
    { at: t(4), text: 'Image #9/24  H  300s  ADU 17988' },
    { at: t(0.4), text: 'Downloading subframe…' },
  ]
}

function DemoAllSkyPlaceholder() {
  return (
    <div className="relative h-full w-auto aspect-video overflow-hidden rounded-lg bg-black">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 55%, #1b2744 0%, #07080d 62%, #020308 100%)',
        }}
      />
      <div className="absolute inset-[12%] rounded-full border border-white/15 bg-[radial-gradient(circle_at_45%_40%,rgba(90,70,40,0.35),transparent_55%)]" />
    </div>
  )
}

function paneLabel(text: string) {
  return (
    <div className="shrink-0 border-b border-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white uppercase">
      {text}
    </div>
  )
}

function formatPreviewOverlayTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function resolveDetail(queueItems: QueueRow[], sessionId: string): QueueRow | null {
  const direct = queueItems.find((item) => item.id === sessionId)
  if (direct) return direct
  for (const item of queueItems) {
    if (!item.nights) continue
    const night = item.nights.find((n) => n.id === sessionId)
    if (!night) continue
    const sky =
      typeof item.raHours === 'number' &&
      Number.isFinite(item.raHours) &&
      typeof item.decDeg === 'number' &&
      Number.isFinite(item.decDeg)
        ? skyCoordsForMosaicPanel(
            {
              raHours: item.raHours,
              decDeg: item.decDeg,
              mosaicMode: item.mosaicMode === true,
              mosaicPanels: item.mosaicPanels,
            },
            night.mosaicPanelIndex,
          )
        : null
    return {
      ...item,
      id: night.id,
      target: `${item.target} — ${nightDisplayLabel(night)}`,
      status:
        night.status === 'in_progress'
          ? 'in_progress'
          : night.status === 'completed'
            ? 'completed'
            : night.status === 'failed'
              ? 'failed'
              : night.status,
      filterPlans: night.filterPlans ?? item.filterPlans,
      estimatedDurationSeconds: night.estimatedDurationSeconds ?? item.estimatedDurationSeconds,
      ...(sky ? { raHours: sky.raHours, decDeg: sky.decDeg } : {}),
    }
  }
  return null
}

export function SessionProgressMonitor() {
  const searchParams = useSearchParams()
  const demoParam = searchParams.get('demo')
  const isDemo = demoParam === '1' || demoParam === 'weather'
  const demoWeather = demoParam === 'weather'
  const sessionId = isDemo ? DEMO_SESSION_ID : (searchParams.get('session') ?? '').trim()
  const { siteId, hasSite, setSiteId } = useObservatorySite()
  const member = useMember()
  const isAdmin = member.status === 'authenticated' && member.isAdmin
  const hasAsc = !demoWeather && (isDemo || siteHasAllSkyCamera(siteId))

  useEffect(() => {
    if (isDemo && !hasSite) setSiteId('pomfret')
  }, [hasSite, isDemo, setSiteId])

  const [queueItems, setQueueItems] = useState<QueueRow[]>([])
  const [lines, setLines] = useState<SessionProgressLine[]>([])
  const [queueStatus, setQueueStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewUpdatedAt, setPreviewUpdatedAt] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [password, setPassword] = useState(() => (sessionId ? recalledSessionPassword(sessionId) : ''))
  const previewFingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    if (isDemo) {
      setPassword('')
      setPasswordDraft('')
      setLines(demoLines())
      setQueueStatus('in_progress')
      setError(null)
      setPreviewUrl(DEMO_PREVIEW_URL)
      setPreviewError(null)
      setPreviewUpdatedAt(new Date().toISOString())
      previewFingerprintRef.current = 'demo'
      return
    }
    setPassword(sessionId ? recalledSessionPassword(sessionId) : '')
    setPasswordDraft('')
    setLines([])
    setQueueStatus(null)
    setError(null)
    setPreviewUrl(null)
    setPreviewError(null)
    setPreviewUpdatedAt(null)
    previewFingerprintRef.current = null
  }, [isDemo, sessionId])

  const detail = useMemo(
    () => (isDemo ? DEMO_DETAIL : sessionId ? resolveDetail(queueItems, sessionId) : null),
    [isDemo, queueItems, sessionId]
  )
  const imagingActive = !isDemo && (queueStatus === 'in_progress' || queueStatus === 'scheduled')

  useAdaptivePoll(
    'site',
    async () => {
      try {
        const res = await observatorySiteFetch('/api/imaging/current-sessions', siteId, { cache: 'no-store' })
        const data = (await res.json().catch(() => ({}))) as { sessions?: QueueRow[]; ok?: boolean }
        if (Array.isArray(data.sessions)) setQueueItems(data.sessions)
      } catch {
        /* keep last */
      }
    },
    { enabled: !isDemo, imagingActive, resetKey: siteId }
  )

  const loadPreview = useCallback(
    async (id: string, pwd: string) => {
      if (!pwd && !isAdmin) return
      try {
        const res = await observatorySiteFetch(
          `/api/imaging/preview?queueId=${encodeURIComponent(id)}&mode=json&_=${Date.now()}`,
          siteId,
          {
            credentials: 'include',
            headers: pwd ? { 'x-session-password': pwd } : {},
            cache: 'no-store',
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true || typeof data.dataBase64 !== 'string') {
          if (res.status === 404) {
            setPreviewUrl(null)
            setPreviewError(null)
            setPreviewUpdatedAt(null)
            previewFingerprintRef.current = null
            return
          }
          setPreviewError(typeof data.error === 'string' ? data.error : 'Preview unavailable.')
          return
        }
        const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
        const dataBase64 = data.dataBase64 as string
        const fingerprint = `${updatedAt ?? ''}|${dataBase64.length}|${dataBase64.slice(0, 240)}|${dataBase64.slice(-240)}`
        if (fingerprint === previewFingerprintRef.current) {
          setPreviewError(null)
          return
        }
        previewFingerprintRef.current = fingerprint
        const contentType = typeof data.contentType === 'string' ? data.contentType : 'image/jpeg'
        setPreviewError(null)
        setPreviewUpdatedAt(updatedAt)
        setPreviewUrl(`data:${contentType};base64,${dataBase64}`)
      } catch {
        setPreviewError('Preview unavailable.')
      }
    },
    [isAdmin, siteId]
  )

  useAdaptivePoll(
    'progress',
    async () => {
      if (!sessionId) return
      try {
        const headers: HeadersInit = password ? { 'x-session-password': password } : {}
        const res = await observatorySiteFetch(`/api/imaging/queue/${encodeURIComponent(sessionId)}/progress`, siteId, {
          cache: 'no-store',
          headers,
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          lines?: SessionProgressLine[]
          queueStatus?: string
          error?: string
        }
        if (!res.ok || data.ok !== true) {
          if (typeof data.error === 'string') setError(data.error)
          return
        }
        setError(null)
        const nextLines = Array.isArray(data.lines) ? data.lines : []
        setLines((prev) => (progressLinesEqual(prev, nextLines) ? prev : nextLines))
        setQueueStatus(typeof data.queueStatus === 'string' ? data.queueStatus : null)
      } catch {
        /* keep last */
      }
    },
    { enabled: Boolean(sessionId) && !isDemo, imagingActive, resetKey: `${siteId}:${sessionId}` }
  )

  useAdaptivePoll(
    'preview',
    () => {
      if (!sessionId) return
      void loadPreview(sessionId, password)
    },
    { enabled: Boolean(sessionId) && !isDemo, imagingActive, resetKey: `${siteId}:${sessionId}:${password}` }
  )

  const status = queueStatus ?? detail?.status ?? null

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden text-gray-100">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {detail?.target ?? (sessionId ? 'Session monitor' : 'Observatory monitor')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? (
            <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(status)}`}>
              {queueStatusLabel(status)}
            </span>
          ) : null}
          <Link href="/dashboard/remote" className={`${glassPillSm} box-border h-8`}>
            Back to Remote
          </Link>
          <NightModeToggle compact className="box-border h-8" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-white/10">
      <div className="grid min-h-0 flex-[0.92] grid-cols-1 gap-px overflow-hidden lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.43fr)_minmax(0,0.95fr)]">
        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel(hasAsc ? 'All-sky camera' : 'Live weather')}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            {hasAsc ? (
              hasSite ? <AllSkyCameraView overlayMode="timestamp" /> : <DemoAllSkyPlaceholder />
            ) : (
              <MonitorWeatherPane />
            )}
          </div>
        </section>

        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel('Latest image')}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            {previewUrl ? (
              <div className="relative min-h-0 min-w-0 max-h-full max-w-full overflow-hidden rounded-lg">
                <img
                  src={previewUrl}
                  alt="Latest session preview"
                  className="block max-h-full max-w-full object-contain"
                />
                <p
                  className="pointer-events-none absolute left-2 top-2 text-[0.8rem] leading-tight text-emerald-400 sm:text-[0.9375rem]"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.55)' }}
                >
                  {formatPreviewOverlayTime(previewUpdatedAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-white/45">{sessionId ? 'No image yet.' : 'Open a session from Remote.'}</p>
            )}
            {previewError ? <p className="absolute bottom-2 text-xs text-white/50">{previewError}</p> : null}
          </div>
        </section>

        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel('Session detail')}
          <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
            {!detail ? (
              <p className="text-white/45">No session loaded.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-2">
                <div>
                  <dt className="text-white/45">Session name</dt>
                  <dd className="text-white">{detail.target}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Session code</dt>
                  <dd className="font-mono text-white">{detail.id}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Submitted</dt>
                  <dd className="text-white">{new Date(detail.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-white/45">RA / Dec</dt>
                  <dd className="text-white">
                    {typeof detail.raHours === 'number' && typeof detail.decDeg === 'number'
                      ? formatRaDecPair(detail.raHours, detail.decDeg)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">Estimated duration</dt>
                  <dd className="text-white">{formatDurationShort(detail.estimatedDurationSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Output</dt>
                  <dd className="text-white">{detail.outputMode ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Contact</dt>
                  <dd className="text-white">
                    {[detail.firstName, detail.lastName].filter(Boolean).join(' ') || '—'}
                    {detail.email ? ` · ${detail.email}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">Imaging plan</dt>
                  <dd className="text-white">
                    {detail.sessionType === 'variable_star'
                      ? formatVariableStarImagingPlan({
                          untilMs: variableStarMonitorUntilMs({
                            scheduleBarEndMs: detail.scheduleBarEndMs,
                            scheduleBarStartMs: detail.scheduleBarStartMs,
                            plannedStartIso: detail.plannedStartIso,
                            estimatedDurationSeconds: detail.estimatedDurationSeconds,
                          }),
                          amplitudeMag: detail.variableStarAmplitudeMag,
                          filterName: detail.filter ?? detail.filterPlans?.[0]?.filterName,
                        })
                      : Array.isArray(detail.filterPlans) && detail.filterPlans.length > 0
                        ? detail.filterPlans
                            .map((p) => `${p.filterName} (${p.count} × ${p.exposureSeconds}s)`)
                            .join(' · ')
                        : '—'}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>

      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden lg:grid-cols-3">
        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel('Terminal')}
          {error ? <p className="shrink-0 px-3 py-2 text-xs text-red-400">{error}</p> : null}
          {!sessionId ? (
            <p className="m-auto px-4 text-center text-sm text-white/45">
              Choose Check progress on a session to stream observatory posts here.
            </p>
          ) : lines.length === 0 ? (
            <div className="m-auto max-w-md px-4 text-center">
              <p className="text-sm text-white/45">
                {queueStatus === 'pending' || queueStatus == null
                  ? 'Waiting for observatory signal.'
                  : queueStatus === 'completed'
                    ? 'Session completed. No further live updates.'
                    : queueStatus === 'failed'
                      ? 'Session marked failed. Waiting for observatory posts…'
                      : 'Waiting for observatory posts…'}
              </p>
              {!isAdmin && !password ? (
                <form
                  className="mt-4 flex flex-col items-stretch gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const next = passwordDraft.trim()
                    if (!next || !sessionId) return
                    rememberSessionPassword(sessionId, next)
                    setPassword(next)
                  }}
                >
                  <input
                    type="password"
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    placeholder="Session password"
                    className="rounded-full border border-white/20 bg-transparent px-3 py-2 text-sm"
                  />
                  <button type="submit" className={glassPillSm}>
                    Use password
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
              {lines.map((line, i) => {
                const failedLine = isSessionFailedTerminalLine(line.text)
                return (
                  <div
                    key={`${line.at}-${i}-${line.text.slice(0, 24)}`}
                    className={`mb-2 whitespace-pre-wrap break-words border-l-2 pl-2 ${
                      failedLine ? 'border-red-600/60' : 'border-green-700/40'
                    }`}
                  >
                    <span className="text-gray-500">[{new Date(line.at).toLocaleTimeString()}]</span>{' '}
                    <span className={failedLine ? 'text-red-400 font-semibold' : 'text-green-400'}>{line.text}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel('Precipitation radar')}
          <div className="min-h-0 flex-1 p-2">
            <LibreWxrRadarMap fill />
          </div>
        </section>

        <section className="flex min-h-[12rem] flex-col overflow-hidden bg-[#08090a] lg:min-h-0">
          {paneLabel('Telescope')}
          <div className="min-h-0 flex-1 p-2">
            <TelescopeStatusPanel fill />
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}
