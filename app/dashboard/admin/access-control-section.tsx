'use client'

import {
  glassPillMd,
  glassPillToggleActive,
  glassPillToggleIdle,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'
import type { SiteAccessControlSettings } from '@/lib/site-access-control'

const pillActive = glassPillToggleActive
const pillIdle = glassPillToggleIdle

export function AccessControlSection({ className = '' }: { className?: string }) {
  const { siteFetch, adminSiteId } = useAdminSiteScope()
  const [settings, setSettings] = useState<SiteAccessControlSettings | null>(null)
  const [durationLimitInput, setDurationLimitInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await siteFetch('/api/admin/site-access-control')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !data.settings) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load access control settings.')
        return
      }
      const next = data.settings as SiteAccessControlSettings
      setSettings(next)
      setDurationLimitInput(String(next.memberProjectDurationLimitHours))
    } catch {
      setError('Could not load access control settings.')
    } finally {
      setLoading(false)
    }
  }, [siteFetch])

  useEffect(() => {
    void load()
  }, [load, adminSiteId])

  async function save() {
    if (!settings) return
    const parsedLimit = Number(durationLimitInput.trim())
    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      setError('Enter a valid duration limit in hours.')
      return
    }
    const payload: SiteAccessControlSettings = {
      ...settings,
      memberProjectDurationLimitHours: parsedLimit,
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
      if (data.settings) {
        const next = data.settings as SiteAccessControlSettings
        setSettings(next)
        setDurationLimitInput(String(next.memberProjectDurationLimitHours))
      }
      setMessage('Access control saved.')
    } catch {
      setError('Could not save access control settings.')
    } finally {
      setSaving(false)
    }
  }

  function updateSettings(patch: Partial<SiteAccessControlSettings>) {
    setSettings((cur) => {
      if (!cur) return cur
      const next = { ...cur, ...patch }
      if (patch.openToGuest === false) {
        next.guestSessionRequiresApproval = false
      }
      return next
    })
    setMessage(null)
  }

  return (
    <DashboardPanel title="Access Control" className={className}>
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      {message ? <p className="mb-2 text-sm text-emerald-400">{message}</p> : null}
      {!settings && loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : settings ? (
        <div className="boxed-fields space-y-4">
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
            {settings.openToGuest ? (
              <>
                <p className="text-sm font-medium text-white">Guest session approval</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => updateSettings({ guestSessionRequiresApproval: false })}
                    className={!settings.guestSessionRequiresApproval ? pillActive : pillIdle}
                  >
                    Direct access
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => updateSettings({ guestSessionRequiresApproval: true })}
                    className={settings.guestSessionRequiresApproval ? pillActive : pillIdle}
                  >
                    Requires approval
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm font-medium text-white">Member project duration limit</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={durationLimitInput}
                disabled={saving}
                onChange={(e) => setDurationLimitInput(e.target.value)}
                className="w-28 rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
              />
              <span className="text-sm text-gray-400">hours</span>
            </div>
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
