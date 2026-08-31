'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'

type MemberSessionRow = {
  id: string
  kind: 'queue' | 'board' | 'project'
  target: string
  status: string
  displayStatus: string
  createdAt: string
  updatedAt: string
  projectMode: boolean
  scheduleReasons?: string[]
  nights?: number
}

export function SessionHistorySection({
  variant = 'panel',
  className = '',
}: {
  variant?: 'panel' | 'boxed'
  className?: string
}) {
  const [sessions, setSessions] = useState<MemberSessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/member/sessions', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.sessions)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load sessions.')
        return
      }
      setSessions(data.sessions as MemberSessionRow[])
    } catch {
      setError('Could not load sessions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const body = (
    <>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {sessions.length === 0 && !loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No sessions yet.</p>
      ) : (
        <ul className="max-h-[16rem] space-y-2 overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-700 px-3 py-2 text-sm">
              <p className="font-medium text-white">{s.target}</p>
              <p className="mt-1 text-xs text-gray-400">{new Date(s.updatedAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  if (variant === 'panel') {
    return (
      <DashboardPanel title="Session History" className={`min-h-[14rem] ${className}`}>
        {body}
      </DashboardPanel>
    )
  }

  return (
    <section className="boxed-fields space-y-3">
      <h2 className="text-lg font-medium text-white">My sessions</h2>
      {body}
    </section>
  )
}
