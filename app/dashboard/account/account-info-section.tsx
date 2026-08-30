'use client'

import { glassPillMd } from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useMember } from '@/hooks/use-member'
import { memberRolesDisplay, type PublicMemberUser } from '@/lib/member-store'

const actionButtonClass = `${glassPillMd} disabled:opacity-50`

const modalActionButtonClass = `${glassPillMd} disabled:opacity-50`

const fieldClass =
  'w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p className="text-gray-400">{label}</p>
      <p className="truncate text-white">{value || '—'}</p>
    </div>
  )
}

export function AccountInfoSection({
  user,
  variant = 'panel',
  className = '',
}: {
  user: PublicMemberUser
  variant?: 'panel' | 'boxed'
  className?: string
}) {
  const member = useMember()
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [email, setEmail] = useState(user.email)
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [username, setUsername] = useState(user.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)
  const [verifySending, setVerifySending] = useState(false)

  async function resendVerification() {
    setVerifySending(true)
    setVerifyMsg(null)
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setVerifyMsg(typeof data.error === 'string' ? data.error : 'Could not send email.')
        return
      }
      setVerifyMsg('Verification email sent. Check your inbox.')
    } catch {
      setVerifyMsg('Could not send email.')
    } finally {
      setVerifySending(false)
    }
  }

  const closeInfoModal = useCallback(() => {
    setInfoModalOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setFormError(null)
    setFormNotice(null)
  }, [])

  function openInfoModal() {
    setEmail(user.email)
    setFirstName(user.firstName)
    setLastName(user.lastName)
    setUsername(user.username)
    setCurrentPassword('')
    setNewPassword('')
    setFormError(null)
    setFormNotice(null)
    setInfoModalOpen(true)
  }

  useEffect(() => {
    if (!infoModalOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeInfoModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [infoModalOpen, saving, closeInfoModal])

  async function handleLogout() {
    await member.signOut()
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          email,
          firstName,
          lastName,
          username,
          newPassword: newPassword.trim() ? newPassword : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setFormError(typeof data.error === 'string' ? data.error : 'Could not update account.')
        return
      }
      if (data.user) member.completeSignIn(data.user as PublicMemberUser)
      else await member.refresh()

      if (data.emailChanged) {
        if (data.verificationSent) {
          setFormNotice('Saved. Check your inbox to verify the new email address.')
        } else {
          setFormNotice(
            typeof data.verificationError === 'string'
              ? `Saved, but verification email failed: ${data.verificationError}`
              : 'Saved. Verify your new email from Account when mail is available.'
          )
        }
        setCurrentPassword('')
        setNewPassword('')
        return
      }

      closeInfoModal()
    } catch {
      setFormError('Could not update account.')
    } finally {
      setSaving(false)
    }
  }

  const accountActions = (
    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
      <button type="button" onClick={openInfoModal} className={actionButtonClass}>
        Update Info
      </button>
      <button type="button" onClick={() => void handleLogout()} className={actionButtonClass}>
        Log out
      </button>
    </div>
  )

  const roleValue = memberRolesDisplay(user)

  const body = (
    <>
      {!user.emailVerified ? (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-transparent px-4 py-3 text-sm text-amber-100">
          <p>Verify your email to use imaging features.</p>
          <button
            type="button"
            disabled={verifySending}
            onClick={() => void resendVerification()}
            className={`${actionButtonClass} mt-2`}
          >
            {verifySending ? 'Sending…' : 'Resend verification email'}
          </button>
          {verifyMsg ? <p className="mt-2 text-xs text-amber-200/90">{verifyMsg}</p> : null}
        </div>
      ) : user.imagingPending ? (
        <div className="mb-4 rounded-lg border border-sky-500/40 bg-transparent px-4 py-3 text-sm text-sky-100">
          Imaging access is pending administrator approval for non-@pomfret.org accounts.
        </div>
      ) : user.imagingRejected ? (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          Imaging access was not approved for this account. Contact the observatory team.
        </div>
      ) : null}

      <div className="flex w-full flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:gap-x-8 lg:gap-x-10">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-6 gap-y-2 sm:gap-x-8 lg:gap-x-10">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Username" value={user.username} />
          <InfoRow label="First name" value={user.firstName} />
          <InfoRow label="Last name" value={user.lastName} />
          <InfoRow label="Role" value={roleValue} />
        </div>
        {accountActions}
      </div>

      {infoModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!saving) closeInfoModal()
          }}
        >
          <div
            role="dialog"
            aria-labelledby="update-info-title"
            className="w-full max-w-md rounded-xl border border-gray-700 bg-[#09090a] p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="update-info-title" className="text-lg font-semibold text-white">
              Update Info
            </h2>
            <form onSubmit={(e) => void handleSaveInfo(e)} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="text-gray-400">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                  autoComplete="email"
                  required
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-gray-400">Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={fieldClass}
                  autoComplete="username"
                  required
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span className="text-gray-400">First name</span>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={fieldClass}
                    autoComplete="given-name"
                    required
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-gray-400">Last name</span>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={fieldClass}
                    autoComplete="family-name"
                    required
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-gray-400">Current password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={fieldClass}
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-gray-400">New password (optional)</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                  className={fieldClass}
                  autoComplete="new-password"
                  minLength={8}
                />
              </label>
              {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
              {formNotice ? <p className="text-sm text-amber-200">{formNotice}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!saving) closeInfoModal()
                  }}
                  disabled={saving}
                  className={modalActionButtonClass}
                >
                  {formNotice ? 'Close' : 'Cancel'}
                </button>
                {!formNotice ? (
                  <button
                    type="submit"
                    disabled={saving || !currentPassword}
                    className={modalActionButtonClass}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )

  if (variant === 'panel') {
    return (
      <DashboardPanel title="Account Info" compact className={className}>
        {body}
      </DashboardPanel>
    )
  }

  return (
    <section className={`boxed-fields space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-end gap-3">{accountActions}</div>
      {body}
    </section>
  )
}
