'use client'

import {
  glassPillDangerSm,
  glassPillMd,
  glassPillSuccessSm,
  glassPillToggleActive,
  glassPillToggleIdle,
  glassPillXs,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'
import {
  adminMemberRoleOptions,
  memberRoleKey,
  type AdminMemberRoleOption,
} from '@/lib/admin-member-role-edit'
import { isPomfretAstroAdmin, type SiteRole } from '@/lib/member-roles'
import type { SystemRole } from '@/lib/member-roles'

type Row = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  createdAt: string
  systemRole: SystemRole
  memberships: Array<{
    siteId: string
    siteRole: SiteRole
    siteName: string
    imagingApprovedAt: string | null
    imagingRejectedAt: string | null
  }>
  roles: string[]
  emailVerified: boolean
  emailVerifiedAt: string | null
  bootstrapAdmin?: boolean
}

type MembersPayload = {
  ok?: boolean
  members?: Row[]
  total?: number
  canManageAdmins?: boolean
  currentUserId?: string
  isPaAdmin?: boolean
  scope?: string
  siteName?: string | null
  error?: string
}

const pillActive = glassPillToggleActive
const pillIdle = glassPillToggleIdle

function displayName(row: Row): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email
}

function rolesLabel(row: Row): string {
  return row.roles.length > 0 ? row.roles.join(' · ') : 'Guest'
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p className="text-gray-400">{label}</p>
      <p className="break-words text-white">{value || '—'}</p>
    </div>
  )
}

function MemberModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="member-modal-title"
        className="w-[min(100%,32rem)] rounded-xl border border-gray-700 bg-[#08090a] p-6 shadow-xl"
      >
        <p id="member-modal-title" className="text-lg font-medium text-white">
          {title}
        </p>
        <div className="mt-4 space-y-4">{children}</div>
        <div className="mt-6 flex justify-end">
          <button type="button" className={glassPillMd} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function AllMembersSection({ className = '' }: { className?: string }) {
  const { siteFetch, adminSiteId, membersScope, adminSite, isPaAdmin } = useAdminSiteScope()
  const [members, setMembers] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [canManageAdmins, setCanManageAdmins] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [checkRow, setCheckRow] = useState<Row | null>(null)
  const [editRow, setEditRow] = useState<Row | null>(null)
  const [editRoleKey, setEditRoleKey] = useState('')
  const [editEmailVerified, setEditEmailVerified] = useState(false)
  const [editImagingAction, setEditImagingAction] = useState<'approve' | 'reject' | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const roleOptions: AdminMemberRoleOption[] = useMemo(
    () => adminMemberRoleOptions({ isPaAdmin, siteId: adminSiteId }),
    [isPaAdmin, adminSiteId]
  )

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

  function openEdit(row: Row) {
    setEditRow(row)
    setEditRoleKey(
      memberRoleKey({
        systemRole: row.systemRole,
        memberships: row.memberships,
        preferredSiteId: isPaAdmin ? undefined : adminSiteId,
      })
    )
    setEditEmailVerified(row.emailVerified)
    setEditImagingAction(null)
    setEditError(null)
  }

  async function saveEdit() {
    if (!editRow) return
    setEditSaving(true)
    setEditError(null)
    try {
      const data = await patchMember({
        id: editRow.id,
        roleKey: editRoleKey,
        emailVerified: editEmailVerified,
        ...(editImagingAction ? { imagingAction: editImagingAction } : {}),
      })
      if (!data?.ok) {
        setEditError(typeof data.error === 'string' ? data.error : 'Could not update member.')
        return
      }
      applyPayload(data)
      setEditRow(null)
    } catch {
      setEditError('Could not update member.')
    } finally {
      setEditSaving(false)
    }
  }

  async function removeMember(row: Row) {
    const name = displayName(row)
    const confirmText = isPaAdmin
      ? `Permanently delete account “${name}” (${row.email})? This cannot be undone.`
      : `Remove “${name}” from ${adminSite.name}? If this is their last observatory, they become Guest.`
    if (!window.confirm(confirmText)) return
    setActingId(row.id)
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
      setActingId(null)
    }
  }

  function canManageRow(row: Row): boolean {
    if (row.id === currentUserId) return false
    if (row.bootstrapAdmin && !canManageAdmins) return false
    if (isPaAdmin) {
      if (isPomfretAstroAdmin(row.systemRole) && !canManageAdmins) return false
      return true
    }
    if (isPomfretAstroAdmin(row.systemRole)) return false
    return row.memberships.some((m) => m.siteId === adminSiteId)
  }

  function siteMembership(row: Row) {
    return row.memberships.find((m) => m.siteId === adminSiteId) ?? null
  }

  function imagingStatusLabel(m: Row['memberships'][number] | null): string {
    if (!m || m.siteRole === 'observatory_admin') return '—'
    if (m.imagingRejectedAt) return 'Imaging rejected'
    if (m.imagingApprovedAt) return 'Imaging approved'
    return 'Imaging pending'
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
            const busy = actingId === m.id
            const manageable = canManageRow(m)
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white break-words">{name}</p>
                  <p className="text-gray-400">{rolesLabel(m)}</p>
                </div>
                {manageable ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => setCheckRow(m)}
                      className={`${glassPillXs} disabled:opacity-40`}
                    >
                      Check Info
                    </button>
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => openEdit(m)}
                      className={`${glassPillXs} disabled:opacity-40`}
                    >
                      Edit Info
                    </button>
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void removeMember(m)}
                      className={`${glassPillDangerSm} disabled:opacity-40`}
                    >
                      {busy ? '…' : 'Remove'}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {checkRow ? (
        <MemberModal title={displayName(checkRow)} onClose={() => setCheckRow(null)}>
          <InfoRow label="First name" value={checkRow.firstName} />
          <InfoRow label="Last name" value={checkRow.lastName} />
          <InfoRow label="Username" value={checkRow.username} />
          <InfoRow label="Email" value={checkRow.email} />
          <InfoRow label="Role" value={rolesLabel(checkRow)} />
          <InfoRow
            label="Email verified"
            value={checkRow.emailVerified ? 'Yes' : 'No'}
          />
          <InfoRow
            label="Member since"
            value={new Date(checkRow.createdAt).toLocaleString()}
          />
          {checkRow.memberships.length > 0 ? (
            <InfoRow
              label="Affiliations"
              value={checkRow.memberships
                .map((m) => {
                  const imaging =
                    m.siteRole === 'observatory_admin'
                      ? ''
                      : m.imagingRejectedAt
                        ? ' · imaging rejected'
                        : m.imagingApprovedAt
                          ? ' · imaging approved'
                          : ' · imaging pending'
                  return `${m.siteName} (${m.siteRole === 'observatory_admin' ? 'Admin' : 'Member'}${imaging})`
                })
                .join(' · ')}
            />
          ) : null}
        </MemberModal>
      ) : null}

      {editRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-labelledby="member-edit-title"
            className="w-[min(100%,32rem)] rounded-xl border border-gray-700 bg-[#08090a] p-6 shadow-xl"
          >
            <p id="member-edit-title" className="text-lg font-medium text-white">
              Edit {displayName(editRow)}
            </p>
            {editError ? <p className="mt-2 text-sm text-red-400">{editError}</p> : null}
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Role</p>
                <select
                  value={editRoleKey}
                  disabled={editSaving}
                  onChange={(e) => setEditRoleKey(e.target.value)}
                  className="w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
                >
                  {roleOptions.map((opt) => (
                    <option key={opt.key} value={opt.key} className="bg-[#08090a]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Email verified</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => setEditEmailVerified(true)}
                    className={editEmailVerified ? pillActive : pillIdle}
                  >
                    Verified
                  </button>
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => setEditEmailVerified(false)}
                    className={!editEmailVerified ? pillActive : pillIdle}
                  >
                    Not verified
                  </button>
                </div>
              </div>
              {siteMembership(editRow) && siteMembership(editRow)!.siteRole === 'observatory_member' ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-white">
                    Imaging at {adminSite.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    Current: {imagingStatusLabel(siteMembership(editRow))}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={editSaving}
                      onClick={() => setEditImagingAction('approve')}
                      className={editImagingAction === 'approve' ? pillActive : pillIdle}
                    >
                      Approve imaging
                    </button>
                    <button
                      type="button"
                      disabled={editSaving}
                      onClick={() => setEditImagingAction('reject')}
                      className={editImagingAction === 'reject' ? pillActive : pillIdle}
                    >
                      Reject imaging
                    </button>
                    <button
                      type="button"
                      disabled={editSaving}
                      onClick={() => setEditImagingAction(null)}
                      className={editImagingAction === null ? pillActive : pillIdle}
                    >
                      No change
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={editSaving}
                className={glassPillMd}
                onClick={() => setEditRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving}
                className={`${glassPillSuccessSm} disabled:opacity-40`}
                onClick={() => void saveEdit()}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardPanel>
  )
}
