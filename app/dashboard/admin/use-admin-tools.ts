'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMember } from '@/hooks/use-member'

export type AuditLogRow = {
  id: string
  at: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

export type SessionControlRow = {
  sessionId: string
  label: string
  target: string
  status: string
  kind: 'normal' | 'project_sub'
  projectId?: string
  nightIndex?: number
  plannedStartIso?: string | null
  updatedAt: string
}

export type ObservatoryMode = 'manual' | 'auto'
export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export const statusOptions: { value: ObservatoryStatus; label: string }[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'busy_in_use', label: 'Busy -- In Use' },
  { value: 'closed_weather_not_permitted', label: 'Closed -- Weather Not Permitted' },
  { value: 'closed_daytime', label: 'Closed -- Daytime' },
  { value: 'closed_observatory_maintenance', label: 'Closed -- Observatory Maintenance' },
]

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

export function tonightScheduleWindowLocal(now = new Date()): { start: Date; end: Date } {
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

export function parseTonightTimeToDate(value: string, windowStart: Date): Date | null {
  const m = value.match(HHMM_REGEX)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const d = new Date(windowStart)
  d.setHours(h, min, 0, 0)
  if (h < 16) d.setDate(d.getDate() + 1)
  return d
}

export function useAdminTools() {
  const member = useMember()
  const authorized = member.status === 'authenticated' && member.isAdmin
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
  const [sessionRows, setSessionRows] = useState<SessionControlRow[]>([])
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionActionId, setSessionActionId] = useState<string | null>(null)

  const adminHeaders = useMemo((): HeadersInit => ({}), [])

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    setLogError(null)
    try {
      const res = await fetch('/api/imaging/audit-log?limit=200', {
        credentials: 'include',
        headers: adminHeaders,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.entries)) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load log')
      }
      setLogEntries((data.entries as AuditLogRow[]).filter((e) => e.kind !== 'session.progress'))
    } catch {
      setLogError('Unable to load activity log.')
    } finally {
      setLogLoading(false)
    }
  }, [adminHeaders])

  useEffect(() => {
    if (!authorized) return
    void loadLog()
  }, [authorized, loadLog])

  useEffect(() => {
    if (!authorized) return
    void (async () => {
      try {
        const res = await fetch('/api/imaging/observatory-status', { credentials: 'include' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.status) return
        if (data.mode === 'manual' || data.mode === 'auto') setMode(data.mode)
        setStatus(data.status as ObservatoryStatus)
      } catch {
        // ignore
      }
    })()
  }, [authorized])

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

  const loadSessionControl = useCallback(async () => {
    setSessionLoading(true)
    setSessionError(null)
    try {
      const res = await fetch('/api/imaging/session-control', {
        credentials: 'include',
        headers: adminHeaders,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.sessions)) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load sessions')
      }
      setSessionRows(data.sessions as SessionControlRow[])
    } catch {
      setSessionError('Unable to load session control list.')
    } finally {
      setSessionLoading(false)
    }
  }, [adminHeaders])

  useEffect(() => {
    if (!authorized) return
    void loadSessionControl()
  }, [authorized, loadSessionControl])

  async function runSessionAction(sessionId: string, action: 'complete' | 'fail' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete session ${sessionId}? This cannot be undone.`)) {
      return
    }
    setSessionActionId(sessionId)
    setSessionError(null)
    try {
      const res = await fetch('/api/imaging/session-control', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ action, sessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Action failed')
      }
      if (Array.isArray(data.sessions)) {
        setSessionRows(data.sessions as SessionControlRow[])
      } else {
        await loadSessionControl()
      }
      await loadLog()
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setSessionActionId(null)
    }
  }

  async function updateStatus(next: ObservatoryStatus) {
    setSaving(true)
    try {
      const res = await fetch('/api/imaging/observatory-status', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Update failed')
      setStatus(data.status as ObservatoryStatus)
      if (data.mode === 'manual' || data.mode === 'auto') setMode(data.mode)
      await loadLog()
    } catch {
      setScheduleError('Failed to update status.')
    } finally {
      setSaving(false)
    }
  }

  async function updateMode(next: ObservatoryMode) {
    setSaving(true)
    try {
      const res = await fetch('/api/imaging/observatory-status', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ mode: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Update failed')
      setMode(data.mode as ObservatoryMode)
      setStatus(data.status as ObservatoryStatus)
      await loadLog()
    } catch {
      setScheduleError('Failed to update mode.')
    } finally {
      setSaving(false)
    }
  }

  async function submitClosedWindow(e: React.FormEvent) {
    e.preventDefault()
    setScheduleSaving(true)
    setScheduleError(null)
    try {
      if (!closedWindowDescription.trim()) {
        setScheduleError('Description is required.')
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
        setScheduleError('Use HH:MM, e.g. 19:30.')
        return
      }
      if (
        startDate.getTime() < tonightWindow.start.getTime() ||
        endDate.getTime() > tonightWindow.end.getTime()
      ) {
        setScheduleError('Range must be within tonight (4:00 PM – 8:00 AM).')
        return
      }
      if (endDate.getTime() <= startDate.getTime()) {
        setScheduleError('End must be after start.')
        return
      }
      const res = await fetch('/api/imaging/schedule-control', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          description: closedWindowDescription.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setScheduleError(typeof data.error === 'string' ? data.error : 'Failed to add window.')
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
  }

  return {
    member,
    authorized,
    mode,
    status,
    saving,
    logEntries,
    logLoading,
    logError,
    closedStartLocal,
    setClosedStartLocal,
    closedEndLocal,
    setClosedEndLocal,
    closedWindowDescription,
    setClosedWindowDescription,
    closedWindows,
    scheduleError,
    scheduleSaving,
    sessionRows,
    sessionLoading,
    sessionError,
    sessionActionId,
    adminHeaders,
    loadLog,
    loadClosedWindows,
    loadSessionControl,
    runSessionAction,
    updateStatus,
    updateMode,
    submitClosedWindow,
  }
}
