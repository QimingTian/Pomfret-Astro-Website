'use client'

import {
  glassPillDangerSm,
  glassPillXs,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'
import { memberVerificationStatusLabel } from '@/lib/member-access'
import { memberRolesDisplay, type MemberRole } from '@/lib/member-store'

type Row = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: MemberRole
  roles?: string[]
  emailVerified: boolean
  imagingApproved: boolean
  imagingPending: boolean
  imagingRejected: boolean
  bootstrapAdmin?: boolean
}

type MembersPayload = {
  ok?: boolean
  members?: Row[]
  total?: number
  canManageAdmins?: boolean
  currentUserId?: string
  scope?: string
  siteName?: string | null
  error?: string
}

function displayName(row: Row): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
}

export function AllMembersSection({ className = '' }: { className?: string }) {
  const { siteFetch, adminSiteId, membersScope, adminSite, isPaAdmin } = useAdminSiteScope()
  const [members, setMembers] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [canManageAdmins, setCanManageAdmins] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [demotingId, setDemotingId] = useState<string | null>(null)

  const panelTitle =
    membersScope === 'all' ? 'All members' : `${adminSite.name} members`

  const applyPayload = (data: MembersPayload) => {
    if (Array.isArray(data.members)) {
      setMembers(data.members)
      setTotal(typeof data.total === 'number' ? data.total : data.members.length)
    }
    if (typeof data.canManageAdmins === 'boolean') setCanManageAdmins(data.canManageAdmins)
    if (typeof data.currentUserId === 'string') setCurrentUserId(data.currentUserId)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await siteFetch('/api/admin/members')
      const data = (await res.json().catch(() => ({}))) as MembersPayload
      if (!res.ok || data?.ok !== true || !Array.isArray(data.members)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load members.')
        return
      }
      applyPayload(data)
    } catch {
      setError('Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [siteFetch])

  useEffect(() => {
    void load()
  }, [load, adminSiteId, membersScope])

  async function patchMember(body: Record<string, unknown>) {
    const res = await siteFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as MembersPayload
  }

  async function setAsAdmin(row: Row) {
    const name = displayName(row)
    if (!window.confirm(`Set “${name}” (${row.email}) as Admin?`)) return
    setPromotingId(row.id)
    setError(null)
    try {
      const data = await patchMember({ id: row.id })
      if (!data?.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not update member.')
        return
      }
      applyPayload(data)
    } catch {
      setError('Could not update member.')
    } finally {
      setPromotingId(null)
    }
  }

  async function setAsMember(row: Row) {
    const name = displayName(row)
    if (!window.confirm(`Set “${name}” (${row.email}) as Member? They will lose admin access.`)) return
    setDemotingId(row.id)
    setError(null)
    try {
      const data = await patchMember({ id: row.id, roleAction: 'member' })
      if (!data?.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not update member.')
        return
      }
      applyPayload(data)
    } catch {
      setError('Could not update member.')
    } finally {
      setDemotingId(null)
    }
  }

  async function removeMember(row: Row) {
    const name = displayName(row)
    if (!window.confirm(`Remove “${name}” (${row.email})? This cannot be undone.`)) return
    setRemovingId(row.id)
    setError(null)
    try {
      const res = await siteFetch(`/api/admin/members?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as MembersPayload
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Could not remove member.')
        return
      }
      applyPayload(data)
    } catch {
      setError('Could not remove member.')
    } finally {
      setRemovingId(null)
    }
  }

  function canManageRow(row: Row): boolean {
    if (row.id === currentUserId) return false
    if (row.bootstrapAdmin) return false
    if (!isPaAdmin) return false
    if (row.role === 'member') return true
    return canManageAdmins && row.role === 'admin'
  }

  return (
    <DashboardPanel
      title={`${panelTitle}${total > 0 ? ` (${total})` : ''}`}
      className={`min-h-0 ${className}`}
    >
      {error && <p className="text-sm text-red-400">{error}</p>}
      {members.length === 0 && !loading ? (
        <p className="text-sm text-gray-500">No members yet.</p>
      ) : (
        <ul className="max-h-[22rem] space-y-2 overflow-y-auto">
          {members.map((m) => {
            const name = displayName(m)
            const busyRemove = removingId === m.id
            const busyPromote = promotingId === m.id
            const busyDemote = demotingId === m.id
            const busy = busyRemove || busyPromote || busyDemote
            const manageable = canManageRow(m)
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
                  <span>{memberRolesDisplay(m)}</span>
                  <span className="mx-2">·</span>
                  <span>
                    {memberVerificationStatusLabel({
                      emailVerified: m.emailVerified,
                      imagingApproved: m.imagingApproved,
                    })}
                  </span>
                </p>
                {manageable ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {m.role === 'member' ? (
                      <button
                        type="button"
                        disabled={busy || loading}
                        onClick={() => void setAsAdmin(m)}
                        className={`${glassPillXs} disabled:opacity-40`}
                      >
                        {busyPromote ? '…' : 'Set as Admin'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || loading}
                        onClick={() => void setAsMember(m)}
                        className={`${glassPillXs} disabled:opacity-40`}
                      >
                        {busyDemote ? '…' : 'Set as Member'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void removeMember(m)}
                      className={`${glassPillDangerSm} disabled:opacity-40`}
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
