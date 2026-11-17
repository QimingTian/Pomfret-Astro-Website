'use client'

import {
  glassPillDangerSm,
  glassPillLg,
  glassPillLgWide,
  glassPillMd,
  glassPillSm,
  glassPillSuccessSm,
  glassPillXs,
} from '@/lib/glass-ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import {
  buildRemoteRunSavedSessionUrl,
  deleteMemberSavedSessionById,
} from '@/lib/remote-saved-session'

type SavedRow = {
  id: string
  name: string
  savedAt: string
  updatedAt: string
}

export function SavedSessionsSection({
  variant = 'panel',
  className = '',
}: {
  variant?: 'panel' | 'boxed'
  className?: string
}) {
  const [sessions, setSessions] = useState<SavedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/member/saved-sessions', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.sessions)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load saved sessions.')
        return
      }
      setSessions(
        (data.sessions as SavedRow[]).map((s) => ({
          id: s.id,
          name: s.name,
          savedAt: s.savedAt,
          updatedAt: s.updatedAt,
        }))
      )
    } catch {
      setError('Could not load saved sessions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  async function deleteSession(row: SavedRow) {
    if (!window.confirm(`Delete saved session “${row.name}”? This cannot be undone.`)) return
    setDeletingId(row.id)
    setError(null)
    try {
      const result = await deleteMemberSavedSessionById(row.id)
      if (!result.ok) {
        setError(result.error || 'Could not delete saved session.')
        return
      }
      setSessions((prev) => prev.filter((s) => s.id !== row.id))
    } catch {
      setError('Could not delete saved session.')
    } finally {
      setDeletingId(null)
    }
  }

  const body = (
    <>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {sessions.length === 0 && !loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No saved sessions yet.</p>
      ) : (
        <ul className="max-h-[16rem] space-y-2 overflow-y-auto">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{s.name}</p>
                <p className="mt-1 text-xs text-gray-400">Updated {new Date(s.updatedAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link href={buildRemoteRunSavedSessionUrl(s.id)} className={glassPillSm}>
                  Run this session
                </Link>
                <button
                  type="button"
                  className={`${glassPillDangerSm} disabled:opacity-40`}
                  disabled={deletingId === s.id}
                  onClick={() => void deleteSession(s)}
                >
                  {deletingId === s.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  if (variant === 'panel') {
    return (
      <DashboardPanel title="Saved Sessions" className={`min-h-[14rem] ${className}`}>
        {body}
      </DashboardPanel>
    )
  }

  return (
    <section className="boxed-fields space-y-3">
      <h2 className="text-lg font-medium text-white">Saved sessions</h2>
      {body}
    </section>
  )
}
