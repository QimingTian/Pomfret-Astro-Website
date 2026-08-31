'use client'

import {
  glassPillMd,
  glassPillToggleActive,
  glassPillToggleIdle,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'
import {
  defaultSessionGatePolicy,
  normalizeEmailSuffixes,
  type SessionGateMode,
  type SessionGatePolicy,
  type SiteAccessControlSettings,
} from '@/lib/site-access-control'
import type { ObservatorySiteId } from '@/lib/observatory-sites'

const pillActive = glassPillToggleActive
const pillIdle = glassPillToggleIdle

type OtherObsOption = { id: ObservatorySiteId; name: string }

function SessionPolicyControls({
  label,
  policy,
  disabled,
  onChange,
  hoursInput,
  onHoursInputChange,
}: {
  label: string
  policy: SessionGatePolicy
  disabled: boolean
  onChange: (policy: SessionGatePolicy) => void
  hoursInput: string
  onHoursInputChange: (value: string) => void
}) {
  function setMode(mode: SessionGateMode) {
    onChange({
      ...policy,
      mode,
      durationLimitHours:
        policy.durationLimitHours > 0 ? policy.durationLimitHours : defaultSessionGatePolicy().durationLimitHours,
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-white">{label}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('direct')}
          className={policy.mode === 'direct' ? pillActive : pillIdle}
        >
          Direct access
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('always_approve')}
          className={policy.mode === 'always_approve' ? pillActive : pillIdle}
        >
          Always approve
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('duration_limit')}
          className={policy.mode === 'duration_limit' ? pillActive : pillIdle}
        >
          Free under limit
        </button>
      </div>
      {policy.mode === 'duration_limit' ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={hoursInput}
            disabled={disabled}
            onChange={(e) => onHoursInputChange(e.target.value)}
            className="w-28 rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
          />
          <span className="text-sm text-gray-400">hours</span>
        </div>
      ) : null}
    </div>
  )
}

export function AccessControlSection({ className = '' }: { className?: string }) {
  const { siteFetch, adminSiteId } = useAdminSiteScope()
  const [settings, setSettings] = useState<SiteAccessControlSettings | null>(null)
  const [otherObservatories, setOtherObservatories] = useState<OtherObsOption[]>([])
  const [memberLimitInput, setMemberLimitInput] = useState('')
  const [guestLimitInput, setGuestLimitInput] = useState('')
  const [otherLimitInput, setOtherLimitInput] = useState('')
  const [emailSuffixesInput, setEmailSuffixesInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const applySettings = useCallback((next: SiteAccessControlSettings) => {
    setSettings(next)
    setMemberLimitInput(String(next.memberProjectDurationLimitHours))
    setGuestLimitInput(String(next.guestSessionPolicy.durationLimitHours))
    setOtherLimitInput(String(next.otherMemberSessionPolicy.durationLimitHours))
    setEmailSuffixesInput(next.memberEmailAutoJoinSuffixes.join(', '))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSettings(null)
    try {
      const res = await siteFetch('/api/admin/site-access-control')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !data.settings) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load access control settings.')
        return
      }
      applySettings(data.settings as SiteAccessControlSettings)
      setOtherObservatories(
        Array.isArray(data.otherObservatories) ? (data.otherObservatories as OtherObsOption[]) : []
      )
    } catch {
      setError('Could not load access control settings.')
    } finally {
      setLoading(false)
    }
  }, [siteFetch, applySettings])

  useEffect(() => {
    void load()
  }, [load, adminSiteId])

  function updateSettings(patch: Partial<SiteAccessControlSettings>) {
    setSettings((cur) => {
      if (!cur) return cur
      return { ...cur, ...patch }
    })
    setMessage(null)
  }

  function parseHours(raw: string, fallback: number): number | null {
    const n = Number(raw.trim())
    if (!Number.isFinite(n) || n < 0) return null
    return n
  }

  async function save() {
    if (!settings) return
    const memberHours = parseHours(memberLimitInput, settings.memberProjectDurationLimitHours)
    const guestHours = parseHours(guestLimitInput, settings.guestSessionPolicy.durationLimitHours)
    const otherHours = parseHours(otherLimitInput, settings.otherMemberSessionPolicy.durationLimitHours)
    if (memberHours == null || guestHours == null || otherHours == null) {
      setError('Enter valid duration limits in hours.')
      return
    }

    const payload: SiteAccessControlSettings = {
      ...settings,
      memberProjectDurationLimitHours: memberHours,
      guestSessionPolicy: {
        ...settings.guestSessionPolicy,
        durationLimitHours: guestHours,
      },
      otherMemberSessionPolicy: {
        ...settings.otherMemberSessionPolicy,
        durationLimitHours: otherHours,
      },
      memberEmailAutoJoinSuffixes: normalizeEmailSuffixes(emailSuffixesInput),
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await siteFetch('/api/admin/site-access-control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save access control settings.')
        return
      }
      if (data.settings) applySettings(data.settings as SiteAccessControlSettings)
      setMessage('Access control saved.')
    } catch {
      setError('Could not save access control settings.')
    } finally {
      setSaving(false)
    }
  }

  function toggleOtherSite(siteId: ObservatorySiteId) {
    if (!settings) return
    const scope = settings.otherObservatoryMemberScope
    if (scope === 'all') {
      updateSettings({ otherObservatoryMemberScope: [siteId] })
      return
    }
    const has = scope.includes(siteId)
    const next = has ? scope.filter((id) => id !== siteId) : [...scope, siteId]
    updateSettings({ otherObservatoryMemberScope: next.length > 0 ? next : 'all' })
  }

  const otherScopeIsAll = settings?.otherObservatoryMemberScope === 'all'
  const otherScopeList =
    settings && Array.isArray(settings.otherObservatoryMemberScope)
      ? settings.otherObservatoryMemberScope
      : []

  return (
    <DashboardPanel title="Access Control" className={className}>
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      {message ? <p className="mb-2 text-sm text-emerald-400">{message}</p> : null}
      {!settings && loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : settings ? (
        <div className="boxed-fields space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm font-medium text-white">Open to Guest</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateSettings({ openToGuest: true })}
                  className={settings.openToGuest ? pillActive : pillIdle}
                >
                  Open
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateSettings({ openToGuest: false })}
                  className={!settings.openToGuest ? pillActive : pillIdle}
                >
                  Closed
                </button>
              </div>
            </div>
            {settings.openToGuest ? (
              <SessionPolicyControls
                label="Guest sessions"
                policy={settings.guestSessionPolicy}
                disabled={saving}
                hoursInput={guestLimitInput}
                onHoursInputChange={setGuestLimitInput}
                onChange={(guestSessionPolicy) => updateSettings({ guestSessionPolicy })}
              />
            ) : null}
          </div>

          <div className="space-y-3 border-t border-gray-800 pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm font-medium text-white">Open to other observatories&apos; members</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateSettings({ openToOtherObservatoryMembers: true })}
                  className={settings.openToOtherObservatoryMembers ? pillActive : pillIdle}
                >
                  Open
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateSettings({ openToOtherObservatoryMembers: false })}
                  className={!settings.openToOtherObservatoryMembers ? pillActive : pillIdle}
                >
                  Closed
                </button>
              </div>
            </div>

            {settings.openToOtherObservatoryMembers ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-white">Which observatories</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateSettings({ otherObservatoryMemberScope: 'all' })}
                      className={otherScopeIsAll ? pillActive : pillIdle}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        updateSettings({
                          otherObservatoryMemberScope:
                            otherObservatories[0] ? [otherObservatories[0].id] : 'all',
                        })
                      }
                      className={!otherScopeIsAll ? pillActive : pillIdle}
                    >
                      Specific
                    </button>
                  </div>
                  {!otherScopeIsAll ? (
                    <div className="flex flex-wrap gap-2">
                      {otherObservatories.map((obs) => {
                        const selected = otherScopeList.includes(obs.id)
                        return (
                          <button
                            key={obs.id}
                            type="button"
                            disabled={saving}
                            onClick={() => toggleOtherSite(obs.id)}
                            className={selected ? pillActive : pillIdle}
                          >
                            {obs.name}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <SessionPolicyControls
                  label="Other members&apos; sessions"
                  policy={settings.otherMemberSessionPolicy}
                  disabled={saving}
                  hoursInput={otherLimitInput}
                  onHoursInputChange={setOtherLimitInput}
                  onChange={(otherMemberSessionPolicy) => updateSettings({ otherMemberSessionPolicy })}
                />
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-800 pt-4">
            <p className="text-sm font-medium text-white">Own members project duration limit</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={memberLimitInput}
                disabled={saving}
                onChange={(e) => setMemberLimitInput(e.target.value)}
                className="w-28 rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
              />
              <span className="text-sm text-gray-400">hours</span>
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-800 pt-4">
            <p className="text-sm font-medium text-white">Auto-join email suffixes</p>
            <input
              type="text"
              value={emailSuffixesInput}
              disabled={saving}
              onChange={(e) => {
                setEmailSuffixesInput(e.target.value)
                setMessage(null)
              }}
              placeholder="@pomfret.org"
              className="w-full max-w-md rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
            />
          </div>

          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void save()}
            className={`${glassPillMd} disabled:opacity-50`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : null}
    </DashboardPanel>
  )
}
