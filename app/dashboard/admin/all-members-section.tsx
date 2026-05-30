'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { memberLevelLabel, type MemberRole } from '@/lib/member-store'

type Row = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: MemberRole
  emailVerified: boolean
  imagingApproved: boolean
  imagingPending: boolean
  imagingRejected: boolean
}

export function AllMembersSection({ className = '' }: { className?: string }) {
  const [members, setMembers] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [imagingActionId, setImagingActionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/members', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.members)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load members.')
        return
      }
      setMembers(data.members as Row[])
      setTotal(typeof data.total === 'number' ? data.total : (data.members as Row[]).length)
    } catch {
      setError('Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setAsAdmin(row: Row) {
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
    if (!window.confirm(`Set “${name}” (${row.email}) as Admin?`)) return
    setPromotingId(row.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/members', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Could not update member.')
        return
      }
      if (Array.isArray(data.members)) {
        setMembers(data.members as Row[])
        setTotal(typeof data.total === 'number' ? data.total : (data.members as Row[]).length)
      } else {
        await load()
      }
    } catch {
      setError('Could not update member.')
    } finally {
      setPromotingId(null)
    }
  }

  async function setImagingAccess(row: Row, action: 'approve' | 'reject') {
    const label = action === 'approve' ? 'approve imaging for' : 'reject imaging for'
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
    if (!window.confirm(`${label} “${name}”?`)) return
    setImagingActionId(row.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/members', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, imagingAction: action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Could not update imaging access.')
        return
      }
      if (Array.isArray(data.members)) {
        setMembers(data.members as Row[])
        setTotal(typeof data.total === 'number' ? data.total : (data.members as Row[]).length)
      } else {
        await load()
      }
    } catch {
      setError('Could not update imaging access.')
    } finally {
      setImagingActionId(null)
    }
  }

  async function removeMember(row: Row) {
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
    if (!window.confirm(`Remove member “${name}” (${row.email})? This cannot be undone.`)) return
    setRemovingId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/members?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Could not remove member.')
        return
      }
      if (Array.isArray(data.members)) {
        setMembers(data.members as Row[])
        setTotal(typeof data.total === 'number' ? data.total : (data.members as Row[]).length)
      } else {
        await load()
      }
    } catch {
      setError('Could not remove member.')
    } finally {
      setRemovingId(null)
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

  return (
    <DashboardPanel
      title={`All members${total > 0 ? ` (${total})` : ''}`}
      action={refreshButton}
      className={`min-h-0 ${className}`}
    >
      {error && <p className="text-sm text-red-400">{error}</p>}
      {members.length === 0 && !loading ? (
        <p className="text-sm text-gray-500">No members yet.</p>
      ) : (
        <ul className="max-h-[22rem] space-y-2 overflow-y-auto">
          {members.map((m) => {
            const name = [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || '—'
            const busyRemove = removingId === m.id
            const busyPromote = promotingId === m.id
            const busyImaging = imagingActionId === m.id
            const busy = busyRemove || busyPromote || busyImaging
            const accessLabel = m.imagingApproved
              ? 'Imaging OK'
              : m.imagingPending
                ? 'Imaging pending'
                : m.imagingRejected
                  ? 'Imaging rejected'
                  : m.emailVerified
                    ? 'Email verified'
                    : 'Email unverified'
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm"
              >
                <p className="min-w-0 flex-1 break-words text-white">
                  <span>{name}</span>
                  <span className="mx-2">·</span>
                  <span className="break-all">{m.email}</span>
                  <span className="mx-2">·</span>
                  <span>{memberLevelLabel(m.role)}</span>
                  <span className="mx-2">·</span>
                  <span className="text-gray-400">{accessLabel}</span>
                </p>
                {m.role === 'member' ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {m.imagingPending ? (
                      <>
                        <button
                          type="button"
                          disabled={busy || loading}
                          onClick={() => void setImagingAccess(m, 'approve')}
                          className="rounded-full border border-emerald-500/50 px-3 py-1 text-xs text-emerald-300 disabled:opacity-40"
                        >
                          {busyImaging ? '…' : 'Approve imaging'}
                        </button>
                        <button
                          type="button"
                          disabled={busy || loading}
                          onClick={() => void setImagingAccess(m, 'reject')}
                          className="rounded-full border border-amber-500/50 px-3 py-1 text-xs text-amber-200 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void setAsAdmin(m)}
                      className="rounded-full border border-white/25 bg-[#151616] px-3 py-1 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-40"
                    >
                      {busyPromote ? '…' : 'Set as Admin'}
                    </button>
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void removeMember(m)}
                      className="rounded-full border border-red-500/50 px-3 py-1 text-xs text-red-300 disabled:opacity-40"
                    >
                      {busyRemove ? '…' : 'Remove'}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </DashboardPanel>
  )
}
