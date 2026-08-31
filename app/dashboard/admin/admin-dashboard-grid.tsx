'use client'

import { EmergencyStopButton } from '@/app/dashboard/account/emergency-stop-button'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { accountTwoColGridObservatoryLog } from '@/app/dashboard/account/account-two-col-layout'
import { AccountTwoColRow } from '@/app/dashboard/account/account-two-col-row'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { AccountMemberGrid } from '@/app/dashboard/account/account-member-grid'
import { AdminActivityLogPanel } from '@/app/dashboard/admin/admin-activity-log-panel'
import { GalleryRequestsSection } from '@/app/dashboard/admin/gallery-requests-section'
import { ImagingRequestsSection } from '@/app/dashboard/admin/imaging-requests-section'
import { AllMembersSection } from '@/app/dashboard/admin/all-members-section'
import { AllSkyCameraControlPanel } from '@/app/dashboard/admin/allsky-camera-control-panel'
import { ImagingEquipmentSection } from '@/components/admin/imaging-equipment-section'
import { statusOptions, useAdminTools } from '@/app/dashboard/admin/use-admin-tools'
import { useAdminSiteScope } from '@/hooks/use-admin-site-scope'
import type { PublicMemberUser } from '@/lib/member-store'
import {
  glassPillSkySm,
  glassPillAccentSm,
  glassPillDangerSm,
  glassPillInfoSm,
  glassPillMd,
  glassPillSuccessSm,
  glassPillToggleActive,
  glassPillToggleIdle,
  glassPillToggleActiveBlock,
  glassPillToggleIdleBlock,
  glassPillWarningSm,
  glassPillXs,
} from '@/lib/glass-ui'

const pillActive = glassPillToggleActive
const pillIdle = glassPillToggleIdle
const pillActiveBlock = glassPillToggleActiveBlock
const pillIdleBlock = glassPillToggleIdleBlock

export function AdminDashboardGrid({ user }: { user: PublicMemberUser }) {
  const t = useAdminTools()
  const { adminSiteId, showAllSkyCamera } = useAdminSiteScope()

  if (t.member.status === 'loading') {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  if (!t.authorized) {
    return <p className="text-sm text-gray-400">Administrator access required.</p>
  }

  return (
    <>
      <AccountTwoColRow
        left={
          <DashboardPanel title="Emergency STOP" compact className="min-h-0">
            <EmergencyStopButton user={user} operatingSiteId={adminSiteId} />
          </DashboardPanel>
        }
        right={
          <DashboardPanel title="Session Control">
            {t.sessionError && <p className="mb-2 text-sm text-red-400">{t.sessionError}</p>}
            <div className="max-h-[20rem] space-y-2 overflow-y-auto">
              {t.sessionRows.length === 0 && !t.sessionLoading ? (
                <p className="text-sm text-gray-500">No active sessions.</p>
              ) : (
                t.sessionRows.map((row) => {
                  const busy = t.sessionActionId === row.sessionId
                  const canRun =
                    row.status === 'pending' ||
                    row.status === 'scheduled' ||
                    row.status === 'planned'
                  const canHold =
                    row.status === 'pending' ||
                    row.status === 'scheduled' ||
                    row.status === 'planned'
                  const onHold = row.status === 'on hold' || row.status === 'on_hold'
                  return (
                    <div key={row.sessionId} className="rounded-lg border border-gray-700 px-3 py-2 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-white break-words">{row.label}</p>
                        <p className="text-xs uppercase text-gray-400">{onHold ? 'on hold' : row.status}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busy || !canRun || t.emergencyStopBlocking}
                          onClick={() => void t.runSessionAction(row.sessionId, 'run')}
                          className={`${glassPillSkySm} disabled:opacity-40`}
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          disabled={busy || (!onHold && !canHold)}
                          onClick={() =>
                            void t.runSessionAction(row.sessionId, onHold ? 'release_hold' : 'hold')
                          }
                          className={`${glassPillAccentSm} disabled:opacity-40`}
                        >
                          {onHold ? 'Unhold' : 'Hold'}
                        </button>
                        <button
                          type="button"
                          disabled={busy || row.status === 'completed'}
                          onClick={() => void t.runSessionAction(row.sessionId, 'complete')}
                          className={`${glassPillSuccessSm} disabled:opacity-40`}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          disabled={busy || row.status === 'failed'}
                          onClick={() => void t.runSessionAction(row.sessionId, 'fail')}
                          className={`${glassPillWarningSm} disabled:opacity-40`}
                        >
                          Fail
                        </button>
                        <button
                          type="button"
                          disabled={busy || row.status !== 'failed'}
                          onClick={() => void t.runSessionAction(row.sessionId, 'in_progress')}
                          className={`${glassPillInfoSm} disabled:opacity-40`}
                        >
                          In progress
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void t.runSessionAction(row.sessionId, 'delete')}
                          className={`${glassPillDangerSm} disabled:opacity-40`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </DashboardPanel>
        }
      />

      <AccountFullBleedRule />

      <AccountMemberGrid />

      <AccountFullBleedRule />

      <AccountTwoColRow
        desktopGrid={accountTwoColGridObservatoryLog}
        left={
          <DashboardPanel title="Observatory Status">
            <div className="space-y-3">
              <p className="text-sm font-medium text-white">Mode</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void t.updateMode('manual')}
                  disabled={t.saving}
                  className={`${t.mode === 'manual' ? pillActive : pillIdle}`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => void t.updateMode('auto')}
                  disabled={t.saving}
                  className={`${t.mode === 'auto' ? pillActive : pillIdle}`}
                >
                  Auto
                </button>
              </div>
              <p className="text-sm font-medium text-white">Status</p>
              <div className="space-y-2">
                {statusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => void t.updateStatus(opt.value)}
                    disabled={t.saving || t.mode === 'auto'}
                    className={t.status === opt.value ? pillActiveBlock : pillIdleBlock}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </DashboardPanel>
        }
        right={
          <DashboardPanel
            title="Log"
            action={
              <button
                type="button"
                onClick={() => {
                  if (t.logEntries.length === 0) return
                  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
                  const header = 'Time (UTC),Kind,Message,Detail'
                  const rows = t.logEntries.map((r) =>
                    [
                      escape(r.at),
                      escape(r.kind),
                      escape(r.message),
                      escape(r.detail ? JSON.stringify(r.detail) : ''),
                    ].join(',')
                  )
                  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
                  a.click()
                  URL.revokeObjectURL(a.href)
                }}
                disabled={t.logEntries.length === 0}
                className={`${glassPillXs} disabled:opacity-50`}
              >
                Export
              </button>
            }
          >
            <AdminActivityLogPanel
              entries={t.logEntries}
              loading={t.logLoading}
              error={t.logError}
            />
          </DashboardPanel>
        }
      />

      <AccountFullBleedRule />

      <AccountTwoColRow
        left={
          <DashboardPanel title="Schedule Control">
            <div className="boxed-fields space-y-3">
            <form className="space-y-3" onSubmit={(e) => void t.submitClosedWindow(e)}>
              <input
                type="text"
                value={t.closedWindowDescription}
                onChange={(e) => t.setClosedWindowDescription(e.target.value)}
                placeholder="Description"
                maxLength={200}
                className="w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={t.closedStartLocal}
                  onChange={(e) => t.setClosedStartLocal(e.target.value)}
                  placeholder="Start HH:MM"
                  className="w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
                />
                <input
                  type="text"
                  value={t.closedEndLocal}
                  onChange={(e) => t.setClosedEndLocal(e.target.value)}
                  placeholder="End HH:MM"
                  className="w-full rounded-lg border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                disabled={t.scheduleSaving}
                className={`${glassPillMd} disabled:opacity-50`}
              >
                {t.scheduleSaving ? 'Saving…' : 'Add closed window'}
              </button>
            </form>
            {t.scheduleError && <p className="text-sm text-red-400">{t.scheduleError}</p>}
            {t.closedWindows.length > 0 ? (
            <ul className="max-h-36 space-y-2 overflow-y-auto">
                {t.closedWindows.map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-2 py-2 text-xs"
                  >
                    <div className="min-w-0 text-white">
                      <p>
                        {new Date(w.startIso).toLocaleString()} – {new Date(w.endIso).toLocaleString()}
                      </p>
                      {w.description?.trim() ? <p>{w.description}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await t.siteFetch(
                          `/api/imaging/schedule-control?id=${encodeURIComponent(w.id)}`,
                          {
                            method: 'DELETE',
                            headers: t.adminHeaders,
                          }
                        )
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok || data?.ok !== true) return
                        await t.loadClosedWindows()
                        await t.loadLog()
                      }}
                      className={`shrink-0 ${glassPillDangerSm}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
            ) : null}
            </div>
          </DashboardPanel>
        }
        right={<ImagingRequestsSection />}
      />

      {showAllSkyCamera ? (
        <>
          <AccountFullBleedRule />
          <AllSkyCameraControlPanel />
        </>
      ) : null}

      <AccountFullBleedRule />

      <AccountTwoColRow
        left={<ImagingEquipmentSection />}
        right={<GalleryRequestsSection />}
      />

      <AccountFullBleedRule />

      <AllMembersSection />
    </>
  )
}
