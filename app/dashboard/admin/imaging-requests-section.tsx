'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'

type MemberRow = {
  kind: 'member_access'
  id: string
  firstName: string
  lastName: string
  email: string
}

type LargeProjectRow = {
  kind: 'large_project'
  id: string
  target: string
  submitterLabel: string
  email: string | null
  durationLabel: string
  filterSummary: string
  createdAt: string
}

type Payload = {
  memberRequests: MemberRow[]
  largeProjectRequests: LargeProjectRow[]
  total: number
}

export function ImagingRequestsSection({ className = '' }: { className?: string }) {
  const [data, setData] = useState<Payload>({ memberRequests: [], largeProjectRequests: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingKey, setActingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/imaging-requests', { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok !== true) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load imaging requests.')
        return
      }
      setData({
        memberRequests: Array.isArray(json.memberRequests) ? (json.memberRequests as MemberRow[]) : [],
        largeProjectRequests: Array.isArray(json.largeProjectRequests)
          ? (json.largeProjectRequests as LargeProjectRow[])
          : [],
        total: typeof json.total === 'number' ? json.total : 0,
      })
    } catch {
      setError('Could not load imaging requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(kind: 'member_access' | 'large_project', id: string, action: 'approve' | 'reject') {
    const label = action === 'approve' ? 'approve' : 'reject'
    if (!window.confirm(`${label} this imaging request?`)) return
    setActingKey(`${kind}:${id}`)
    setError(null)
    try {
      const res = await fetch('/api/admin/imaging-requests', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok !== true) {
        setError(typeof json.error === 'string' ? json.error : 'Could not update imaging request.')
        return
      }
      await load()
    } catch {
      setError('Could not update imaging request.')
    } finally {
      setActingKey(null)
    }
  }

  const refreshButton = (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      className="rounded-full border border-white/25 bg-[#151616] px-3 py-1 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
    >
      {loading ? '…' : 'Refresh'}
    </button>
  )

  const empty = data.total === 0 && !loading

  return (
    <DashboardPanel
      title={`Imaging Request${data.total > 0 ? ` (${data.total})` : ''}`}
      action={refreshButton}
      className={className}
    >
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      {empty ? (
        <p className="text-sm text-gray-500">No pending imaging requests.</p>
      ) : (
        <ul className="max-h-[24rem] space-y-3 overflow-y-auto">
          {data.memberRequests.map((row) => {
            const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
            const key = `member:${row.id}`
            const busy = actingKey === key
            return (
              <li key={key} className="rounded-lg border border-gray-700 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-amber-200/90">Member access</p>
                <p className="mt-1 font-medium text-white">{name}</p>
                <p className="break-all text-gray-400">{row.email}</p>
                <p className="mt-1 text-gray-500">Non-@pomfret.org account awaiting imaging approval.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('member_access', row.id, 'approve')}
                    className="rounded-full border border-emerald-500/50 px-3 py-1 text-xs text-emerald-300 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('member_access', row.id, 'reject')}
                    className="rounded-full border border-red-500/50 px-3 py-1 text-xs text-red-300 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </li>
            )
          })}
          {data.largeProjectRequests.map((row) => {
            const key = `project:${row.id}`
            const busy = actingKey === key
            return (
              <li key={key} className="rounded-lg border border-gray-700 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-sky-200/90">Large project</p>
                <p className="mt-1 font-medium text-white">{row.target}</p>
                <p className="text-gray-300">{row.submitterLabel}</p>
                {row.email ? <p className="break-all text-gray-500">{row.email}</p> : null}
                <p className="mt-1 text-gray-400">
                  Total duration {row.durationLabel} (&gt; 30 h) · {row.filterSummary}
                </p>
                <p className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('large_project', row.id, 'approve')}
                    className="rounded-full border border-emerald-500/50 px-3 py-1 text-xs text-emerald-300 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('large_project', row.id, 'reject')}
                    className="rounded-full border border-red-500/50 px-3 py-1 text-xs text-red-300 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardPanel>
  )
}
