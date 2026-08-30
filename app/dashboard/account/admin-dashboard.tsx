'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSiteStream } from '@/lib/use-site-stream'
import { AccountWorkspacePanels } from '@/app/dashboard/account/account-workspace-panels'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { accountTwoColGridAccountEmergency } from '@/app/dashboard/account/account-two-col-layout'
import { AccountTwoColRow } from '@/app/dashboard/account/account-two-col-row'
import { AccountPageHeader } from '@/app/dashboard/account/account-page-header'
import { AccountInfoSection } from '@/app/dashboard/account/account-info-section'
import { observatorySiteFetch } from '@/components/observatory-site-provider'
import { isPomfretAstroAdmin } from '@/lib/member-roles'
import type { PublicMemberUser } from '@/lib/member-store'
import {
  OBSERVATORY_SITES,
  isObservatorySiteId,
  resolveObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import {
  glassPillDangerMd,
  glassPillDangerWide,
  glassPillMd,
} from '@/lib/glass-ui'

type EmergencyStopPhase = 'idle' | 'stopping' | 'stopped'

type EmergencyStopStatus = {
  phase: EmergencyStopPhase
  progress: number
  label: string
  agentConnected: boolean
  canArm: boolean
}

const emergencyStopPillClass = `${glassPillDangerWide} overflow-hidden bg-red-950/80`

function emergencyStopButtonLabel(status: EmergencyStopStatus): string {
  if (status.phase === 'stopping') return 'STOPPING'
  if (status.phase === 'stopped') return 'STOPPED'
  return 'Emergency STOP'
}

function EmergencyStopButton({ user }: { user: PublicMemberUser }) {
  const [pending, setPending] = useState(false)
  const [step, setStep] = useState<'closed' | 'pick-site' | 'confirm'>('closed')
  const [selectedSiteId, setSelectedSiteId] = useState<ObservatorySiteId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [status, setStatus] = useState<EmergencyStopStatus>({
    phase: 'idle',
    progress: 0,
    label: 'ESTOP',
    agentConnected: false,
    canArm: false,
  })

  const siteOptions = useMemo(() => {
    if (isPomfretAstroAdmin(user.systemRole)) {
      return OBSERVATORY_SITES.map((s) => s.id)
    }
    const adminSites = (user.memberships ?? [])
      .filter((m) => m.siteRole === 'observatory_admin' && isObservatorySiteId(m.siteId))
      .map((m) => m.siteId as ObservatorySiteId)
    return adminSites.length > 0 ? adminSites : (['pomfret'] as ObservatorySiteId[])
  }, [user.memberships, user.systemRole])

  const needsSitePicker = isPomfretAstroAdmin(user.systemRole) || siteOptions.length > 1

  const refreshStatus = useCallback(async (siteId?: ObservatorySiteId | null) => {
    const site = siteId ?? siteOptions[0] ?? 'pomfret'
    try {
      const res = await observatorySiteFetch('/api/imaging/emergency-stop', site, {
        credentials: 'include',
        cache: 'no-store',
      })
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
  }, [siteOptions])

  useEffect(() => {
    void refreshStatus(selectedSiteId ?? siteOptions[0] ?? 'pomfret')
  }, [refreshStatus, selectedSiteId, siteOptions])

  useEffect(() => {
    if (status.phase !== 'stopping') return
    const site = selectedSiteId ?? siteOptions[0] ?? 'pomfret'
    const id = window.setInterval(() => void refreshStatus(site), 2000)
    return () => window.clearInterval(id)
  }, [refreshStatus, selectedSiteId, siteOptions, status.phase])

  useSiteStream(
    {
      onEstop: (event) => {
        setStatusLoaded(true)
        setError(null)
        setStatus({
          phase:
            event.phase === 'stopping' || event.phase === 'stopped' || event.phase === 'idle'
              ? event.phase
              : 'idle',
          progress: typeof event.progress === 'number' ? event.progress : 0,
          label: typeof event.label === 'string' ? event.label : 'ESTOP',
          agentConnected: Boolean(event.agentConnected),
          canArm: Boolean(event.canArm),
        })
      },
    },
    true
  )

  function openEmergencyStopFlow() {
    setError(null)
    if (needsSitePicker) {
      setSelectedSiteId(null)
      setStep('pick-site')
      return
    }
    const only = siteOptions[0] ?? 'pomfret'
    setSelectedSiteId(only)
    void refreshStatus(only)
    setStep('confirm')
  }

  function chooseSite(siteId: ObservatorySiteId) {
    setSelectedSiteId(siteId)
    void refreshStatus(siteId)
    setStep('confirm')
  }

  async function confirmEmergencyStop() {
    const site = selectedSiteId ?? siteOptions[0]
    if (!site) return
    setStep('closed')
    setPending(true)
    setError(null)
    try {
      const res = await observatorySiteFetch('/api/imaging/emergency-stop', site, {
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
      await refreshStatus(site)
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
    (!needsSitePicker && (!status.agentConnected || !status.canArm))

  const selectedSiteName = selectedSiteId ? resolveObservatorySite(selectedSiteId).name : null

  return (
    <>
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 py-3 sm:py-4">
        <button
          type="button"
          className={emergencyStopPillClass}
          disabled={disabled}
          onClick={openEmergencyStopFlow}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-red-600 transition-[width] duration-500 ease-out"
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

      {step === 'pick-site' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-labelledby="estop-site-title"
            className="w-[600px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-700 bg-[#08090a] p-6 shadow-xl"
          >
            <p id="estop-site-title" className="text-center text-base text-white">
              Which observatory should receive ESTOP?
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {siteOptions.map((siteId) => {
                const site = resolveObservatorySite(siteId)
                return (
                  <button
                    key={siteId}
                    type="button"
                    className={`${glassPillMd} w-full justify-center`}
                    onClick={() => chooseSite(siteId)}
                  >
                    {site.name}
                  </button>
                )
              })}
            </div>
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                className={`${glassPillMd} whitespace-nowrap`}
                onClick={() => setStep('closed')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-labelledby="estop-confirm-title"
            className="w-[600px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-700 bg-[#08090a] p-6 shadow-xl"
          >
            <p id="estop-confirm-title" className="text-center text-base text-white">
              {selectedSiteName
                ? `ESTOP will kill any ongoing work at ${selectedSiteName} and close the dome.`
                : 'ESTOP will kill any ongoing observatory work and close the dome.'}
            </p>
            {!status.agentConnected || !status.canArm ? (
              <p className="mt-3 text-center text-sm text-amber-200">
                {!status.agentConnected
                  ? 'NINA agent is disconnected for this site.'
                  : 'ESTOP cannot be armed for this site right now.'}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {needsSitePicker ? (
                <button
                  type="button"
                  disabled={pending}
                  className={`${glassPillMd} whitespace-nowrap disabled:opacity-60`}
                  onClick={() => setStep('pick-site')}
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending || !status.agentConnected || !status.canArm}
                className={`${glassPillDangerMd} whitespace-nowrap disabled:opacity-60`}
                onClick={() => void confirmEmergencyStop()}
              >
                Confirm ESTOP
              </button>
              <button
                type="button"
                disabled={pending}
                className={`${glassPillMd} whitespace-nowrap disabled:opacity-60`}
                onClick={() => setStep('closed')}
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
        right={<EmergencyStopButton user={user} />}
      />

      <AccountFullBleedRule />

      <AccountWorkspacePanels isAdmin />
    </div>
  )
}
