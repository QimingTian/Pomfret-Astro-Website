'use client'

import {
  glassPillDangerSm,
  glassPillSuccessSm,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'

type GuestRow = {
  kind: 'guest_access'
  id: string
  firstName: string
  lastName: string
  email: string
  updatedAt: string
}

type MembershipRow = {
  kind: 'membership'
  id: string
  firstName: string
  lastName: string
  email: string
  updatedAt: string
}

type LargeProjectRow = {
  kind: 'large_project'
  id: string
  target: string
  submitterLabel: string
  email: string | null
  durationLabel: string
  durationLimitHours: number
  filterSummary: string
  createdAt: string
}

type Payload = {
  guestRequests: GuestRow[]
  membershipRequests: MembershipRow[]
  largeProjectRequests: LargeProjectRow[]
  durationLimitHours: number
  total: number
}

type ActKind = 'guest_access' | 'membership' | 'large_project'

export function ImagingRequestsSection({ className = '' }: { className?: string }) {
  const { siteFetch, adminSiteId } = useAdminSiteScope()
  const [data, setData] = useState<Payload>({
    guestRequests: [],
    membershipRequests: [],
    largeProjectRequests: [],
    durationLimitHours: 30,
    total: 0,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingKey, setActingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setData({
      guestRequests: [],
      membershipRequests: [],
      largeProjectRequests: [],
      durationLimitHours: 30,
      total: 0,
    })
    try {
      const res = await siteFetch('/api/admin/imaging-requests')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok !== true) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load requests.')
        return
      }
      setData({
        guestRequests: Array.isArray(json.guestRequests) ? (json.guestRequests as GuestRow[]) : [],
        membershipRequests: Array.isArray(json.membershipRequests)
          ? (json.membershipRequests as MembershipRow[])
          : [],
        largeProjectRequests: Array.isArray(json.largeProjectRequests)
          ? (json.largeProjectRequests as LargeProjectRow[])
          : [],
        durationLimitHours:
          typeof json.durationLimitHours === 'number' ? json.durationLimitHours : 30,
        total: typeof json.total === 'number' ? json.total : 0,
      })
    } catch {
      setError('Could not load requests.')
    } finally {
      setLoading(false)
    }
  }, [siteFetch])

  useEffect(() => {
    void load()
  }, [load, adminSiteId])

  async function act(kind: ActKind, id: string, action: 'approve' | 'reject') {
    const label = action === 'approve' ? 'approve' : 'reject'
    if (!window.confirm(`${label} this request?`)) return
    setActingKey(`${kind}:${id}`)
    setError(null)
    try {
      const res = await siteFetch('/api/admin/imaging-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok !== true) {
        setError(typeof json.error === 'string' ? json.error : 'Could not update request.')
        return
      }
      await load()
    } catch {
      setError('Could not update request.')
    } finally {
      setActingKey(null)
    }
  }

  const empty = data.total === 0 && !loading

  return (
    <DashboardPanel
      title={`Imaging & Membership Request${data.total > 0 ? ` (${data.total})` : ''}`}
      className={className}
    >
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      {empty ? (
        <p className="text-sm text-gray-500">No pending imaging or membership requests.</p>
      ) : (
        <ul className="max-h-[24rem] space-y-3 overflow-y-auto">
          {data.membershipRequests.map((row) => {
            const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
            const key = `membership:${row.id}`
            const busy = actingKey === key
            return (
              <li key={key} className="rounded-lg border border-gray-700 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-amber-200/90">Membership</p>
                <p className="mt-1 font-medium text-white">{name}</p>
                <p className="break-all text-gray-400">{row.email}</p>
                <p className="mt-1 text-gray-500">Affiliation application awaiting approval.</p>
                <p className="text-xs text-gray-500">{new Date(row.updatedAt).toLocaleString()}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('membership', row.id, 'approve')}
                    className={`${glassPillSuccessSm} disabled:opacity-40`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('membership', row.id, 'reject')}
                    className={`${glassPillDangerSm} disabled:opacity-40`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            )
          })}
          {data.guestRequests.map((row) => {
            const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
            const key = `guest_access:${row.id}`
            const busy = actingKey === key
            return (
              <li key={key} className="rounded-lg border border-gray-700 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-violet-200/90">Guest access</p>
                <p className="mt-1 font-medium text-white">{name}</p>
                <p className="break-all text-gray-400">{row.email}</p>
                <p className="mt-1 text-gray-500">Guest session access awaiting approval.</p>
                <p className="text-xs text-gray-500">{new Date(row.updatedAt).toLocaleString()}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('guest_access', row.id, 'approve')}
                    className={`${glassPillSuccessSm} disabled:opacity-40`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('guest_access', row.id, 'reject')}
                    className={`${glassPillDangerSm} disabled:opacity-40`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            )
          })}
          {data.largeProjectRequests.map((row) => {
            const key = `large_project:${row.id}`
            const busy = actingKey === key
            return (
              <li key={key} className="rounded-lg border border-gray-700 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-sky-200/90">Session approval</p>
                <p className="mt-1 font-medium text-white">{row.target}</p>
                <p className="text-gray-300">{row.submitterLabel}</p>
                {row.email ? <p className="break-all text-gray-500">{row.email}</p> : null}
                <p className="mt-1 text-gray-400">
                  Total duration {row.durationLabel} (&gt; {row.durationLimitHours} h) · {row.filterSummary}
                </p>
                <p className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('large_project', row.id, 'approve')}
                    className={`${glassPillSuccessSm} disabled:opacity-40`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void act('large_project', row.id, 'reject')}
                    className={`${glassPillDangerSm} disabled:opacity-40`}
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
