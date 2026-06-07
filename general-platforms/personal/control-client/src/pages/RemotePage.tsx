import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  OUTPUT_MODE_LABELS,
  PERSONAL_DEFAULT_OUTPUT_MODE,
  type SessionOutputMode,
} from '@shared/output-mode'
import {
  fetchCurrentSessions,
  observatoryStatusLabel,
  probeHub,
} from '../lib/hub-client'
import { submitSession } from '../lib/submit-session'
import type { SessionRow } from '../lib/types'
import { fetchTonightWeather, type TonightWeatherSnapshot } from '../lib/weather-client'
import type { RemotePrefill } from './AtlasPage'

const FILTER_OPTIONS = [
  { value: 'L', label: 'Luminance' },
  { value: 'R', label: 'Red' },
  { value: 'G', label: 'Green' },
  { value: 'B', label: 'Blue' },
  { value: 'S', label: 'Sulfur' },
  { value: 'H', label: 'Hydrogen' },
  { value: 'O', label: 'Oxygen' },
] as const

function queueStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'scheduled':
      return 'Scheduled'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

function queueStatusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'text-gray-400'
    case 'scheduled':
      return 'text-sky-400'
    case 'in_progress':
      return 'text-green-400'
    case 'completed':
      return 'text-gray-500'
    case 'failed':
      return 'text-red-400'
    default:
      return 'text-gray-400'
  }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : iso
}

type RemotePageProps = {
  prefill?: RemotePrefill | null
  onPrefillConsumed?: () => void
}

export function RemotePage({ prefill, onPrefillConsumed }: RemotePageProps) {
  const [target, setTarget] = useState('')
  const [outputMode, setOutputMode] = useState<SessionOutputMode>(PERSONAL_DEFAULT_OUTPUT_MODE)
  const [filter, setFilter] = useState('L')
  const [exposureSeconds, setExposureSeconds] = useState(600)
  const [count, setCount] = useState(10)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [probe, setProbe] = useState<Awaited<ReturnType<typeof probeHub>> | null>(null)
  const [weather, setWeather] = useState<TonightWeatherSnapshot | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const status = probe?.observatory?.status ?? 'disconnected'
  const tonightWeatherPrediction = weather?.prediction ?? 'loading'

  useEffect(() => {
    if (!prefill) return
    setTarget(prefill.target)
    onPrefillConsumed?.()
  }, [prefill, onPrefillConsumed])

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchCurrentSessions()
      if (data.ok && Array.isArray(data.sessions)) {
        setSessions(
          data.sessions.map((s) => ({
            id: String(s.id ?? ''),
            target: String(s.target ?? '—'),
            status: String(s.status ?? 'unknown'),
            outputMode: typeof s.outputMode === 'string' ? s.outputMode : undefined,
            plannedStartIso: s.plannedStartIso ?? null,
            filter: s.filter ?? null,
            exposureSeconds: s.exposureSeconds ?? null,
            count: s.count ?? null,
          }))
        )
        setSessionsError(null)
      } else {
        setSessions([])
        setSessionsError(typeof data.error === 'string' ? data.error : 'Unable to load sessions')
      }
    } catch (ex) {
      setSessions([])
      setSessionsError(ex instanceof Error ? ex.message : 'Unable to load sessions')
    }
  }, [])

  const refresh = useCallback(async () => {
    const [p, w] = await Promise.all([probeHub(), fetchTonightWeather()])
    setProbe(p)
    setWeather(w)
    await loadSessions()
  }, [loadSessions])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const tonightSchedule = useMemo(() => {
    const start = new Date()
    start.setHours(16, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    end.setHours(8, 0, 0)
    const totalMs = end.getTime() - start.getTime()
    const hours: { label: string; hourStartMs: number; topPct: number }[] = []
    for (let h = 16; h <= 32; h += 1) {
      const slot = new Date(start)
      if (h >= 24) slot.setDate(slot.getDate() + 1)
      slot.setHours(h % 24, 0, 0, 0)
      if (slot.getTime() >= end.getTime()) break
      hours.push({
        label: slot.toLocaleTimeString([], { hour: 'numeric' }),
        hourStartMs: slot.getTime(),
        topPct: ((slot.getTime() - start.getTime()) / totalMs) * 100,
      })
    }
    const nowTopPct =
      Date.now() >= start.getTime() && Date.now() <= end.getTime()
        ? ((Date.now() - start.getTime()) / totalMs) * 100
        : null
    return { start, end, totalMs, hours, nowTopPct }
  }, [])

  const weatherBlocks = useMemo(() => {
    if (!weather?.hours.length) return []
    const startMs = tonightSchedule.start.getTime()
    const endMs = tonightSchedule.end.getTime()
    const span = endMs - startMs
    return weather.hours
      .filter((h) => h.hourStartSec * 1000 >= startMs && h.hourStartSec * 1000 < endMs)
      .map((h) => ({
        kind: h.permitted ? ('permitted' as const) : ('not_permitted' as const),
        topPct: ((h.hourStartSec * 1000 - startMs) / span) * 100,
        heightPct: (3600_000 / span) * 100,
        reasons: h.reasons,
      }))
  }, [weather, tonightSchedule])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSubmitError(null)
    setSubmitOk(null)
    const trimmed = target.trim()
    if (!trimmed) {
      setSubmitError('Enter a session name.')
      setBusy(false)
      return
    }
    const result = await submitSession({
      target: trimmed,
      outputMode,
      filter: filter.trim() || null,
      exposureSeconds,
      count,
    })
    setBusy(false)
    if (!result.ok) {
      setSubmitError(result.error)
      return
    }
    setSubmitOk(`Session queued (${result.id.slice(0, 8)}…)`)
    setTarget('')
    void loadSessions()
  }

  return (
    <div className="pb-4 sm:pb-8">
      <div className="grid gap-4 sm:gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <section className="max-w-3xl min-w-0">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">
            New Imaging Session
          </h1>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Observatory status:{' '}
              <span
                className={
                  status === 'ready'
                    ? 'text-green-600 dark:text-green-400'
                    : !probe?.hubReachable
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-red-600 dark:text-red-400'
                }
              >
                {probe?.hubReachable ? observatoryStatusLabel(status) : 'Hub offline'}
              </span>
              <span className="px-2 text-gray-500 dark:text-gray-500">|</span>
              Tonight&apos;s weather prediction:{' '}
              <span
                className={
                  tonightWeatherPrediction === 'permitted'
                    ? 'text-green-600 dark:text-green-400'
                    : tonightWeatherPrediction === 'unavailable'
                      ? 'text-gray-500 dark:text-gray-500'
                      : tonightWeatherPrediction === 'loading'
                        ? 'text-gray-500 dark:text-gray-500'
                        : 'text-red-600 dark:text-red-400'
                }
              >
                {tonightWeatherPrediction === 'permitted'
                  ? 'Permitted'
                  : tonightWeatherPrediction === 'unavailable'
                    ? 'nighttime now, prediction not available'
                    : tonightWeatherPrediction === 'loading'
                      ? 'Loading...'
                      : 'Not permitted'}
              </span>
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="boxed-fields grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 block space-y-1">
                <span className="text-sm font-medium text-white">Session Name *</span>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. M42"
                  disabled={busy}
                  className="w-full px-3 py-2"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-white">Filter</span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  disabled={busy}
                  className="w-full px-3 py-2"
                >
                  {FILTER_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-white">Exposure (seconds)</span>
                <input
                  type="number"
                  min={1}
                  value={exposureSeconds}
                  onChange={(e) => setExposureSeconds(Number(e.target.value))}
                  disabled={busy}
                  className="w-full px-3 py-2"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-white">Frame count</span>
                <input
                  type="number"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  disabled={busy}
                  className="w-full px-3 py-2"
                />
              </label>

              <div className="sm:col-span-2 space-y-2">
                <span className="text-sm font-medium text-white">Output mode</span>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(OUTPUT_MODE_LABELS) as SessionOutputMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={outputMode === mode}
                      onClick={() => setOutputMode(mode)}
                      disabled={busy}
                      className={`rounded-full border px-4 py-2 text-sm font-medium ${
                        outputMode === mode
                          ? 'border-white/60 bg-[#151616] text-white'
                          : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy || !probe?.hubReachable}
                  className="rounded-full border border-white/25 bg-[#151616] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : 'Submit Session'}
                </button>
              </div>
            </form>

            {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}
            {submitOk && <p className="text-sm text-green-600 dark:text-green-400">{submitOk}</p>}
          </div>
        </section>

        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />

        <section className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">
            Tonight&apos;s Schedule
          </h1>
          <div className="mt-9 relative min-h-[16rem]">
            <div className="absolute left-[4.75rem] top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
            <div className="absolute right-0 lg:-right-16 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
            {tonightSchedule.hours.map((slot) => (
              <div key={slot.hourStartMs}>
                <div
                  className="absolute left-[4.75rem] right-0 lg:-right-16 h-px bg-black/10 dark:bg-white/10"
                  style={{ top: `${slot.topPct}%` }}
                />
                <p
                  className="absolute left-0 w-[4rem] -translate-y-1/2 text-right text-xs text-gray-500 dark:text-gray-500"
                  style={{ top: `${slot.topPct}%` }}
                >
                  {slot.label}
                </p>
              </div>
            ))}
            {tonightSchedule.nowTopPct !== null && (
              <div
                className="absolute left-[4.75rem] right-0 lg:-right-16 h-0.5 bg-red-500/90 z-[1]"
                style={{ top: `${tonightSchedule.nowTopPct}%` }}
              />
            )}
            <div className="pointer-events-none absolute left-[4.75rem] right-0 lg:-right-16 top-0 bottom-0">
              {weatherBlocks.map((block, idx) => (
                <div
                  key={`weather-${idx}`}
                  className="absolute left-[33.333%] right-[33.333%] rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center"
                  style={{
                    top: `${block.topPct}%`,
                    height: `${Math.max(block.heightPct, 4)}%`,
                  }}
                >
                  <p className="text-center text-[10px] leading-4 text-white">
                    {block.kind === 'permitted' ? 'Weather Permitted' : 'Weather Not Permitted'}
                  </p>
                </div>
              ))}
              {sessions
                .filter((s) => s.status !== 'completed' && s.status !== 'failed')
                .slice(0, 6)
                .map((s, idx) => (
                  <div
                    key={s.id}
                    className="absolute left-[66.666%] right-0 rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center"
                    style={{ top: `${8 + idx * 12}%`, height: '8%' }}
                  >
                    <p className="text-center text-[10px] leading-4 text-white truncate">{s.target}</p>
                  </div>
                ))}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 border-t border-black/10 dark:border-white/10 lg:-translate-x-3" />

      <div className="mt-6 sm:mt-8 grid gap-4 sm:gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <section className="max-w-3xl min-w-0">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Current Sessions</h1>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Personal edition queue — sessions are stored in your local Personal Hub.
            </p>
            {sessionsError && <p className="text-sm text-red-600 dark:text-red-400">{sessionsError}</p>}
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-500">No sessions.</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-white">{item.target}</span>
                      <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(item.status)}`}>
                        {queueStatusLabel(item.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.filter ?? '—'} · {item.exposureSeconds ?? '—'}s × {item.count ?? '—'} ·{' '}
                      {formatWhen(item.plannedStartIso)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />

        <section className="min-w-0 w-full">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Telescope Status</h1>
          <div className="rounded-lg border border-gray-700 p-6 min-h-[16rem] flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-center text-gray-400">
              Mount telemetry will appear when Personal Station Agent is connected.
            </p>
            <p className="text-sm text-center">
              <span className="text-white">Agent: </span>
              <span className={status !== 'disconnected' ? 'text-green-400' : 'text-red-400'}>
                {status !== 'disconnected' ? 'Connected' : 'Disconnected'}
              </span>
            </p>
            <p className="text-sm text-center">
              <span className="text-white">Mode: </span>
              <span className="text-gray-300">{probe?.observatory?.mode ?? '—'}</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
