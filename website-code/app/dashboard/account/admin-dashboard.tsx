'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminDashboardGrid } from '@/app/dashboard/admin/admin-dashboard-grid'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { accountTwoColGridAccountEmergency } from '@/app/dashboard/account/account-two-col-layout'
import { AccountTwoColRow } from '@/app/dashboard/account/account-two-col-row'
import { AccountPageHeader } from '@/app/dashboard/account/account-page-header'
import { AccountInfoSection } from '@/app/dashboard/account/account-info-section'
import type { PublicMemberUser } from '@/lib/member-store'

type EmergencyStopPhase = 'idle' | 'stopping' | 'stopped'

type EmergencyStopStatus = {
  phase: EmergencyStopPhase
  progress: number
  label: string
  agentConnected: boolean
  canArm: boolean
}

const emergencyStopPillClass =
  'relative w-full max-w-md overflow-hidden rounded-full border border-red-500/50 bg-red-950 px-5 py-2.5 text-2xl font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60'

function emergencyStopButtonLabel(status: EmergencyStopStatus): string {
  if (status.phase === 'stopping') return 'STOPPING'
  if (status.phase === 'stopped') return 'STOPPED'
  return 'Emergency STOP'
}

function EmergencyStopButton() {
  const [pending, setPending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [status, setStatus] = useState<EmergencyStopStatus>({
    phase: 'idle',
    progress: 0,
    label: 'ESTOP',
    agentConnected: false,
    canArm: false,
  })

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/imaging/emergency-stop', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Unable to load ESTOP status.')
        return
      }
      setError(null)
      setStatus({
        phase:
          data.phase === 'stopping' || data.phase === 'stopped' || data.phase === 'idle'
            ? data.phase
            : 'idle',
        progress: typeof data.progress === 'number' ? data.progress : 0,
        label: typeof data.label === 'string' ? data.label : 'ESTOP',
        agentConnected: Boolean(data.agentConnected),
        canArm: Boolean(data.canArm),
      })
    } catch {
      setError('Unable to load ESTOP status.')
    } finally {
      setStatusLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const intervalMs = status.phase === 'stopping' ? 2000 : 5000
    const id = window.setInterval(() => void refreshStatus(), intervalMs)
    return () => window.clearInterval(id)
  }, [refreshStatus, status.phase])

  async function confirmEmergencyStop() {
    setShowConfirm(false)
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/imaging/emergency-stop', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Emergency STOP failed.')
        return
      }
      await refreshStatus()
    } catch {
      setError('Emergency STOP failed.')
    } finally {
      setPending(false)
    }
  }

  const disabled =
    !statusLoaded ||
    pending ||
    status.phase !== 'idle' ||
    !status.agentConnected ||
    !status.canArm

  return (
    <>
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 py-3 sm:py-4">
        <button
          type="button"
          className={emergencyStopPillClass}
          disabled={disabled}
          onClick={() => setShowConfirm(true)}
        >
          <div
            className="absolute inset-y-0 left-0 bg-red-600 transition-[width] duration-500 ease-out"
            style={{ width: `${status.progress}%` }}
            aria-hidden
          />
          <span className="relative z-10">
            {!statusLoaded
              ? 'Loading…'
              : pending
                ? 'Sending…'
                : emergencyStopButtonLabel(status)}
          </span>
        </button>
        {error ? <p className="max-w-xs text-center text-xs text-red-300">{error}</p> : null}
      </div>

      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-labelledby="estop-confirm-title"
            className="w-[600px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-700 bg-[#08090a] p-6 shadow-xl"
          >
            <p id="estop-confirm-title" className="text-center text-base text-white">
              ESTOP will kill any ongoing observatory work and close the dome.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={pending}
                className="rounded-full border border-red-500/50 bg-red-600 px-5 py-2.5 text-lg font-semibold text-white hover:bg-red-500 active:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void confirmEmergencyStop()}
              >
                Confirm ESTOP
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded-full border border-white/25 bg-[#151616] px-5 py-2.5 text-lg font-semibold text-white hover:bg-[#1b1c1c] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function AdminAccountDashboard({ user }: { user: PublicMemberUser }) {
  return (
    <div className="pb-4 sm:pb-8">
      <AccountPageHeader username={user.username} />

      <AccountTwoColRow
        desktopGrid={accountTwoColGridAccountEmergency}
        left={<AccountInfoSection user={user} variant="panel" className="min-h-0" />}
        right={<EmergencyStopButton />}
      />

      <AccountFullBleedRule />

      <AdminDashboardGrid />
    </div>
  )
}
