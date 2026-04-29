'use client'

import { useCallback, useEffect, useState } from 'react'

type AuditLogRow = {
  id: string
  at: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

type ObservatoryMode = 'manual' | 'auto'
type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

const statusOptions: { value: ObservatoryStatus; label: string }[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'busy_in_use', label: 'Busy -- In Use' },
  { value: 'closed_weather_not_permitted', label: 'Closed -- Weather Not Permitted' },
  { value: 'closed_daytime', label: 'Closed -- Daytime' },
  { value: 'closed_observatory_maintenance', label: 'Closed -- Observatory Maintenance' },
]

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

function tonightScheduleWindowLocal(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now)
  start.setHours(16, 0, 0, 0)
  if (now.getHours() < 8) {
    start.setDate(start.getDate() - 1)
  }
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setHours(8, 0, 0, 0)
  return { start, end }
}

function parseTonightTimeToDate(value: string, windowStart: Date): Date | null {
  const m = value.match(HHMM_REGEX)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const d = new Date(windowStart)
  d.setHours(h, min, 0, 0)
  if (h < 16) d.setDate(d.getDate() + 1)
  return d
}

export default function AdminPage() {
  const [passwordInput, setPasswordInput] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [mode, setMode] = useState<ObservatoryMode>('manual')
  const [status, setStatus] = useState<ObservatoryStatus>('ready')
  const [saving, setSaving] = useState(false)
  const [logEntries, setLogEntries] = useState<AuditLogRow[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [closedStartLocal, setClosedStartLocal] = useState('')
  const [closedEndLocal, setClosedEndLocal] = useState('')
  const [closedWindowDescription, setClosedWindowDescription] = useState('')
  const [closedWindows, setClosedWindows] = useState<
    Array<{ id: string; startIso: string; endIso: string; description?: string }>
  >([])
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSaving, setScheduleSaving] = useState(false)

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    setLogError(null)
    try {
      const res = await fetch('/api/imaging/audit-log?limit=200', {
        headers: { 'x-admin-password': passwordInput },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.entries)) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load log')
      }
      setLogEntries(
        (data.entries as AuditLogRow[]).filter((e) => e.kind !== 'session.progress')
      )
    } catch {
      setLogError('Unable to load activity log.')
    } finally {
      setLogLoading(false)
    }
  }, [passwordInput])

  useEffect(() => {
    if (!authorized) return
    void loadLog()
  }, [authorized, loadLog])

  const loadClosedWindows = useCallback(async () => {
    setScheduleError(null)
    try {
      const res = await fetch('/api/imaging/schedule-control')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.windows)) {
        throw new Error('Failed to load schedule control')
      }
      setClosedWindows(
        data.windows
          .filter((x: unknown) => x && typeof x === 'object')
          .map((x: unknown) => {
            const rec = x as Record<string, unknown>
            return {
              id: typeof rec.id === 'string' ? rec.id : '',
              startIso: typeof rec.startIso === 'string' ? rec.startIso : '',
              endIso: typeof rec.endIso === 'string' ? rec.endIso : '',
              description: typeof rec.description === 'string' ? rec.description : undefined,
            }
          })
          .filter((x: { id: string; startIso: string; endIso: string }) => x.id && x.startIso && x.endIso)
      )
    } catch {
      setScheduleError('Unable to load schedule control.')
    }
  }, [])

  useEffect(() => {
    if (!authorized) return
    void loadClosedWindows()
  }, [authorized, loadClosedWindows])

  async function loadStatus(password: string) {
    const res = await fetch('/api/imaging/observatory-status')
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.status) throw new Error('Failed to load status')
    if (data.mode === 'manual' || data.mode === 'auto') {
      setMode(data.mode)
    }
    setStatus(data.status as ObservatoryStatus)
    setAuthorized(password === '1894')
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setAuthError(null)
    if (passwordInput !== '1894') {
      setAuthError('Incorrect password.')
      return
    }
    try {
      await loadStatus(passwordInput)
    } catch {
      setAuthError('Unable to load current status.')
    }
  }

  async function updateStatus(next: ObservatoryStatus) {
    setSaving(true)
    try {
      const res = await fetch('/api/imaging/observatory-status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': passwordInput,
        },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Update failed')
      }
      setStatus(data.status as ObservatoryStatus)
      if (data.mode === 'manual' || data.mode === 'auto') {
        setMode(data.mode)
      }
      await loadLog()
    } catch {
      setAuthError('Failed to update status.')
    } finally {
      setSaving(false)
    }
  }

  async function updateMode(next: ObservatoryMode) {
    setSaving(true)
    try {
      const res = await fetch('/api/imaging/observatory-status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': passwordInput,
        },
        body: JSON.stringify({ mode: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Update failed')
      setMode(data.mode as ObservatoryMode)
      setStatus(data.status as ObservatoryStatus)
      await loadLog()
    } catch {
      setAuthError('Failed to update mode.')
    } finally {
      setSaving(false)
    }
  }

  if (!authorized) {
    return (
      <div className="pb-8 max-w-3xl lg:-translate-x-3">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Admin</h1>
        <section className="rounded-2xl space-y-4 max-w-xl">
          <form onSubmit={handleUnlock} className="boxed-fields space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Password</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            {authError && <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>}
            <button
              type="submit"
              className="rounded-full border border-white/25 bg-[#151616] text-white px-4 py-2 text-sm font-medium hover:bg-[#1b1c1c]"
            >
              Unlock
            </button>
          </form>
        </section>
        <section className="mt-8 rounded-2xl space-y-4">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Contact</h1>
          <div className="grid gap-6 sm:grid-cols-2">
            <article className="boxed-fields space-y-3">
              <img
                src="/james.jpg"
                alt="James Tian"
                className="h-64 w-full rounded-lg object-cover"
              />
              <div className="space-y-1">
                <p className="text-base font-semibold text-white">James Tian</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">Operator, Tech Support</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">qtian.28@pomfret.org</p>
              </div>
            </article>
            <article className="boxed-fields space-y-3">
              <img
                src="/lucas.jpg"
                alt="Lucas Shi"
                className="h-64 w-full rounded-lg object-cover"
              />
              <div className="space-y-1">
                <p className="text-base font-semibold text-white">Lucas Shi</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">Tech Assistant</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">jshi.29@pomfret.org</p>
              </div>
            </article>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="pb-8 space-y-8 lg:-translate-x-3">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,3fr)] lg:items-start">
      <section className="rounded-2xl space-y-5 max-w-xl">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Observatory Status</h1>
          <h2 className="text-sm font-medium text-white">Mode</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void updateMode('manual')}
              disabled={saving}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                mode === 'manual'
                  ? 'border-white/60 bg-[#151616] text-white'
                  : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => void updateMode('auto')}
              disabled={saving}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                mode === 'auto'
                  ? 'border-white/60 bg-[#151616] text-white'
                  : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
              }`}
            >
              Auto
            </button>
          </div>
          <h2 className="text-sm font-medium text-white">Observatory status</h2>
          <div className="space-y-2">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => void updateStatus(opt.value)}
                disabled={saving || mode === 'auto'}
                className={`w-full text-left rounded-full border px-4 py-2 text-sm font-medium ${
                  status === opt.value
                    ? 'border-white/60 bg-[#151616] text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Activity Log</h1>
          <button
            type="button"
            onClick={() => void loadLog()}
            disabled={logLoading}
            className="rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
          >
            {logLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {logError && <p className="text-sm text-red-600 dark:text-red-400">{logError}</p>}
        <div className="relative">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
          <div className="admin-activity-log-scroll max-h-[28rem] overflow-y-auto bg-[#08090a] px-4 py-3 font-mono text-xs leading-relaxed text-gray-100">
            {logEntries.length === 0 && !logLoading ? (
              <p className="text-gray-500">No log entries yet.</p>
            ) : (
              <ul className="space-y-3">
                {logEntries.map((row) => {
                  const detailText =
                    row.detail && Object.keys(row.detail).length > 0 ? JSON.stringify(row.detail, null, 2) : null
                  return (
                    <li key={row.id} className="border-b border-gray-700/80 pb-3 last:border-0 last:pb-0">
                      <p className="whitespace-pre-wrap break-words text-gray-100">
                        {`${row.at.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')} | ${row.kind} | ${row.message}`}
                      </p>
                      {detailText ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-gray-400">{`detail | ${detailText}`}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
      </div>

      <div className="h-px w-full bg-black/10 dark:bg-white/10" />
      <section className="rounded-2xl space-y-4 max-w-3xl">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Schedule Control</h1>
        <form
          className="boxed-fields space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setScheduleSaving(true)
            setScheduleError(null)
            try {
              if (!closedWindowDescription.trim()) {
                setScheduleError('A short description is required (shown on the Remote schedule).')
                return
              }
              if (!closedStartLocal || !closedEndLocal) {
                setScheduleError('Start and end time are required.')
                return
              }
              const tonightWindow = tonightScheduleWindowLocal(new Date())
              const startDate = parseTonightTimeToDate(closedStartLocal.trim(), tonightWindow.start)
              const endDate = parseTonightTimeToDate(closedEndLocal.trim(), tonightWindow.start)
              if (!startDate || !endDate) {
                setScheduleError('Please input time as HH:MM, for example 19:30.')
                return
              }
              if (startDate.getTime() < tonightWindow.start.getTime() || endDate.getTime() > tonightWindow.end.getTime()) {
                setScheduleError('Time range must be within tonight (4:00 PM to 8:00 AM).')
                return
              }
              if (endDate.getTime() <= startDate.getTime()) {
                setScheduleError('End time must be later than start time.')
                return
              }
              const startIso = startDate.toISOString()
              const endIso = endDate.toISOString()
              const res = await fetch('/api/imaging/schedule-control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': passwordInput },
                body: JSON.stringify({
                  startIso,
                  endIso,
                  description: closedWindowDescription.trim(),
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data?.ok !== true) {
                setScheduleError(typeof data.error === 'string' ? data.error : 'Failed to add closed window.')
                return
              }
              setClosedStartLocal('')
              setClosedEndLocal('')
              setClosedWindowDescription('')
              await loadClosedWindows()
              await loadLog()
            } finally {
              setScheduleSaving(false)
            }
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium text-white">Description *</span>
            <input
              type="text"
              value={closedWindowDescription}
              onChange={(e) => setClosedWindowDescription(e.target.value)}
              placeholder="e.g. Dome maintenance — shown on Remote schedule"
              maxLength={200}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Close Start (HH:MM)</span>
              <input
                type="text"
                value={closedStartLocal}
                onChange={(e) => setClosedStartLocal(e.target.value)}
                placeholder="19:30"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Close End (HH:MM)</span>
              <input
                type="text"
                value={closedEndLocal}
                onChange={(e) => setClosedEndLocal(e.target.value)}
                placeholder="23:15"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={scheduleSaving}
                className="rounded-full border border-white/25 bg-[#151616] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
              >
                {scheduleSaving ? 'Saving…' : 'Add Closed Window'}
              </button>
            </div>
          </div>
        </form>
        {scheduleError && <p className="text-sm text-red-600 dark:text-red-400">{scheduleError}</p>}
        <div className="boxed-fields space-y-2">
          {closedWindows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No admin closed windows scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {closedWindows.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 px-3 py-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm text-white">
                      {new Date(w.startIso).toLocaleString()} – {new Date(w.endIso).toLocaleString()}
                    </p>
                    {w.description?.trim() ? (
                      <p className="text-xs text-gray-400 break-words">{w.description.trim()}</p>
                    ) : (
                      <p className="text-xs text-gray-500 italic">No description</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await fetch(`/api/imaging/schedule-control?id=${encodeURIComponent(w.id)}`, {
                        method: 'DELETE',
                        headers: { 'x-admin-password': passwordInput },
                      })
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok || data?.ok !== true) {
                        setScheduleError(typeof data.error === 'string' ? data.error : 'Failed to remove window.')
                        return
                      }
                      await loadClosedWindows()
                      await loadLog()
                    }}
                    className="rounded-full border border-red-500/50 bg-[#151616] px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-[#1b1c1c]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
