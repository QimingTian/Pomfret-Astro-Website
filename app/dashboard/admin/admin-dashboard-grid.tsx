'use client'

import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { accountTwoColGridObservatoryLog } from '@/app/dashboard/account/account-two-col-layout'
import { AccountTwoColRow } from '@/app/dashboard/account/account-two-col-row'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import { AccountMemberGrid } from '@/app/dashboard/account/account-member-grid'
import { AllMembersSection } from '@/app/dashboard/admin/all-members-section'
import { statusOptions, useAdminTools } from '@/app/dashboard/admin/use-admin-tools'

const pillActive = 'border-white/60 bg-[#151616] text-white'
const pillIdle = 'border-gray-600 bg-[#151616] text-gray-300 hover:text-white'

export function AdminDashboardGrid() {
  const t = useAdminTools()

  if (t.member.status === 'loading') {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  if (!t.authorized) {
    return <p className="text-sm text-gray-400">Administrator access required.</p>
  }

  return (
    <>
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
                  className={`rounded-full border px-3 py-2 text-sm font-medium ${t.mode === 'manual' ? pillActive : pillIdle}`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => void t.updateMode('auto')}
                  disabled={t.saving}
                  className={`rounded-full border px-3 py-2 text-sm font-medium ${t.mode === 'auto' ? pillActive : pillIdle}`}
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
                    className={`w-full rounded-full border px-4 py-2 text-left text-sm font-medium ${
                      t.status === opt.value ? pillActive : pillIdle
                    }`}
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
                onClick={() => void t.loadLog()}
                disabled={t.logLoading}
                className="rounded-full border border-white/25 bg-[#151616] px-3 py-1 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
              >
                {t.logLoading ? '…' : 'Refresh'}
              </button>
            }
          >
            {t.logError && <p className="mb-2 text-sm text-red-400">{t.logError}</p>}
            <div className="admin-activity-log-scroll max-h-[28rem] overflow-y-auto font-mono text-xs leading-relaxed text-gray-100">
              {t.logEntries.length === 0 && !t.logLoading ? (
                <p className="text-gray-500">No log entries yet.</p>
              ) : (
                <ul className="space-y-3">
                  {t.logEntries.map((row) => {
                    const detailText =
                      row.detail && Object.keys(row.detail).length > 0
                        ? JSON.stringify(row.detail, null, 2)
                        : null
                    return (
                      <li key={row.id} className="border-b border-gray-800/80 pb-2 last:border-0 last:pb-0">
                        <p className="whitespace-pre-wrap break-words text-gray-100">
                          {`${row.at.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')} | ${row.kind} | ${row.message}`}
                        </p>
                        {detailText ? (
                          <p className="mt-1 whitespace-pre-wrap break-words text-gray-400">{`detail | ${detailText}`}</p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </DashboardPanel>
        }
      />

      <AccountFullBleedRule />

      <AccountTwoColRow
        left={
          <DashboardPanel title="Schedule Control">
            <form className="boxed-fields space-y-3" onSubmit={(e) => void t.submitClosedWindow(e)}>
              <input
                type="text"
                value={t.closedWindowDescription}
                onChange={(e) => t.setClosedWindowDescription(e.target.value)}
                placeholder="Description (shown on Remote)"
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
                className="rounded-full border border-white/25 bg-[#151616] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
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
                    <div className="min-w-0 text-gray-300">
                      <p>
                        {new Date(w.startIso).toLocaleString()} – {new Date(w.endIso).toLocaleString()}
                      </p>
                      {w.description?.trim() ? <p className="text-gray-500">{w.description}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch(`/api/imaging/schedule-control?id=${encodeURIComponent(w.id)}`, {
                          method: 'DELETE',
                          credentials: 'include',
                          headers: t.adminHeaders,
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok || data?.ok !== true) return
                        await t.loadClosedWindows()
                        await t.loadLog()
                      }}
                      className="shrink-0 rounded-full border border-red-500/50 px-2 py-1 text-red-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
            ) : null}
          </DashboardPanel>
        }
        right={
          <DashboardPanel
            title="Session Control"
            action={
              <button
                type="button"
                onClick={() => void t.loadSessionControl()}
                disabled={t.sessionLoading}
                className="rounded-full border border-white/25 bg-[#151616] px-3 py-1 text-xs font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-50"
              >
                {t.sessionLoading ? '…' : 'Refresh'}
              </button>
            }
          >
            {t.sessionError && <p className="mb-2 text-sm text-red-400">{t.sessionError}</p>}
            <div className="max-h-[20rem] space-y-2 overflow-y-auto">
              {t.sessionRows.length === 0 && !t.sessionLoading ? (
                <p className="text-sm text-gray-500">No active sessions.</p>
              ) : (
                t.sessionRows.map((row) => {
                  const busy = t.sessionActionId === row.sessionId
                  return (
                    <div key={row.sessionId} className="rounded-lg border border-gray-700 px-3 py-2 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-white break-words">{row.label}</p>
                        <p className="text-xs uppercase text-gray-400">{row.status}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busy || row.status === 'completed'}
                          onClick={() => void t.runSessionAction(row.sessionId, 'complete')}
                          className="rounded-full border border-green-500/50 px-2 py-1 text-xs text-green-300 disabled:opacity-40"
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          disabled={busy || row.status === 'failed'}
                          onClick={() => void t.runSessionAction(row.sessionId, 'fail')}
                          className="rounded-full border border-amber-500/50 px-2 py-1 text-xs text-amber-200 disabled:opacity-40"
                        >
                          Fail
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void t.runSessionAction(row.sessionId, 'delete')}
                          className="rounded-full border border-red-500/50 px-2 py-1 text-xs text-red-300 disabled:opacity-40"
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

      <AllMembersSection />
    </>
  )
}
