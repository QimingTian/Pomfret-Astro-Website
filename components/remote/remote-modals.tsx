'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'
import { formatRaDecPair } from '@/lib/format-radec'
import { formatDurationShort } from '@/lib/remote/format'
import { queueStatusLabel, isSessionFailedTerminalLine } from '@/lib/remote/queue-status'
import { nightDisplayLabel } from '@/lib/remote/night-label'
import { queueStatusBadgeClass } from '@/lib/remote/ui-status'
import {
  loadMemberSavedSessionByName,
  saveMemberSavedSession,
  type MemberSavedSessionApiEntry,
  type RemoteSavedSessionFormV1,
} from '@/lib/remote-saved-session'
import {
  glassPillDangerSolid,
  glassPillFullWidthSm,
  glassPillMd,
  glassPillMuted,
  glassPillXs,
} from '@/lib/glass-ui'

export type SessionProgressLine = { at: string; text: string }

export type AuthModalAction = 'progress' | 'project_progress' | 'project_download' | 'download' | 'edit'

export type RemoteModalQueueItem = {
  id: string
  target: string
  createdAt: string
  status: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  raHours?: number | null
  decDeg?: number | null
  filter?: string | null
  exposureSeconds?: number
  count?: number
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  cameraCoolingTempC?: -10 | 0
  estimatedDurationSeconds?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  plannedStartIso?: string | null
  scheduleReasons?: string[]
  hasDownload?: boolean
  downloadPath?: string
  hasPreview?: boolean
  previewPath?: string
  sessionType?: 'dso' | 'variable_star'
  failedAt?: string | null
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
  projectMode?: boolean
  mosaicMode?: boolean
  mosaicPanels?: MosaicPanel[]
  mosaicFilterPlansByPanel?: Array<Array<{ filterName: string; exposureSeconds: number; count: number }>>
  userId?: string | null
  projectFramesTotal?: number
  projectFramesCaptured?: number
  projectFilterProgress?: Array<{ filterName: string; total: number; captured: number }>
  nights?: Array<{
    id: string
    nightIndex: number
    nightKey: string
    sessionLabel?: string
    mosaicPanelIndex?: number
    mosaicSubIndex?: number
    status: string
    plannedStartIso?: string | null
    scheduleStripNightKey?: string | null
    scheduleBarStartMs?: number | null
    scheduleBarEndMs?: number | null
    failedAt?: string | null
    estimatedDurationSeconds?: number
    filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
    hasDownload?: boolean
    downloadPath?: string
  }>
}

export type RemoteModalsProps = {
  terminalSessionId: string | null
  setTerminalSessionId: Dispatch<SetStateAction<string | null>>
  terminalQueueStatus: string | null
  terminalLoading: boolean
  terminalError: string | null
  terminalLines: SessionProgressLine[]
  terminalEndRef: RefObject<HTMLDivElement>
  terminalPreviewUrl: string | null
  terminalPreviewUpdatedAt: string | null
  terminalPreviewError: string | null
  terminalSessionDetail: RemoteModalQueueItem | null
  nightPickerProjectId: string | null
  nightPickerPurpose: 'progress' | 'download' | null
  queueItems: RemoteModalQueueItem[]
  sessionOwnedByMe: (item: { userId?: string | null; email?: string | null }) => boolean
  sessionPasswords: Record<string, string>
  isAdmin: boolean
  downloadSessionFile: (queueId: string, password: string) => Promise<string | null>
  setDeleteError: Dispatch<SetStateAction<string | null>>
  setNightPickerProjectId: Dispatch<SetStateAction<string | null>>
  setNightPickerPurpose: Dispatch<SetStateAction<'progress' | 'download' | null>>
  setAuthModalSessionId: Dispatch<SetStateAction<string | null>>
  setAuthModalAction: Dispatch<SetStateAction<AuthModalAction | null>>
  setAuthError: Dispatch<SetStateAction<string | null>>
  setSessionPasswords: Dispatch<SetStateAction<Record<string, string>>>
  authModalSessionId: string | null
  authModalAction: AuthModalAction | null
  authPassword: string
  setAuthPassword: Dispatch<SetStateAction<string>>
  authError: string | null
  authSubmitting: boolean
  setAuthSubmitting: Dispatch<SetStateAction<boolean>>
  beginEditSession: (item: RemoteModalQueueItem) => void
  showDeleteModal: boolean
  deleteTargetId: string | null
  deletePassword: string
  setDeletePassword: Dispatch<SetStateAction<string>>
  deleteError: string | null
  deleteSubmitting: boolean
  setDeleteSubmitting: Dispatch<SetStateAction<boolean>>
  setShowDeleteModal: Dispatch<SetStateAction<boolean>>
  setDeleteTargetId: Dispatch<SetStateAction<string | null>>
  handleDeleteRequest: (id: string, password: string) => Promise<void>
  showSaveRemoteSessionModal: boolean
  saveModalName: string
  setSaveModalName: Dispatch<SetStateAction<string>>
  saveModalError: string | null
  setSaveModalError: Dispatch<SetStateAction<string | null>>
  setShowSaveRemoteSessionModal: Dispatch<SetStateAction<boolean>>
  captureRemoteSavedForm: () => RemoteSavedSessionFormV1
  refreshCloudSavedSessions: () => Promise<void>
  setRequestName: Dispatch<SetStateAction<string>>
  setSubmitError: Dispatch<SetStateAction<string | null>>
  setSubmitSuccess: Dispatch<SetStateAction<string | null>>
  showRunRemoteSessionModal: boolean
  cloudSavedSessions: MemberSavedSessionApiEntry[]
  runModalName: string
  setRunModalName: Dispatch<SetStateAction<string>>
  runModalError: string | null
  setRunModalError: Dispatch<SetStateAction<string | null>>
  setShowRunRemoteSessionModal: Dispatch<SetStateAction<boolean>>
  applyRemoteSavedForm: (form: RemoteSavedSessionFormV1) => void
}

export function RemoteModals({
  terminalSessionId,
  setTerminalSessionId,
  terminalQueueStatus,
  terminalLoading,
  terminalError,
  terminalLines,
  terminalEndRef,
  terminalPreviewUrl,
  terminalPreviewUpdatedAt,
  terminalPreviewError,
  terminalSessionDetail,
  nightPickerProjectId,
  nightPickerPurpose,
  queueItems,
  sessionOwnedByMe,
  sessionPasswords,
  isAdmin,
  downloadSessionFile,
  setDeleteError,
  setNightPickerProjectId,
  setNightPickerPurpose,
  setAuthModalSessionId,
  setAuthModalAction,
  setAuthError,
  setSessionPasswords,
  authModalSessionId,
  authModalAction,
  authPassword,
  setAuthPassword,
  authError,
  authSubmitting,
  setAuthSubmitting,
  beginEditSession,
  showDeleteModal,
  deleteTargetId,
  deletePassword,
  setDeletePassword,
  deleteError,
  deleteSubmitting,
  setDeleteSubmitting,
  setShowDeleteModal,
  setDeleteTargetId,
  handleDeleteRequest,
  showSaveRemoteSessionModal,
  saveModalName,
  setSaveModalName,
  saveModalError,
  setSaveModalError,
  setShowSaveRemoteSessionModal,
  captureRemoteSavedForm,
  refreshCloudSavedSessions,
  setRequestName,
  setSubmitError,
  setSubmitSuccess,
  showRunRemoteSessionModal,
  cloudSavedSessions,
  runModalName,
  setRunModalName,
  runModalError,
  setRunModalError,
  setShowRunRemoteSessionModal,
  applyRemoteSavedForm,
}: RemoteModalsProps) {
  return (
    <>
      {terminalSessionId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl rounded-xl border border-gray-700 bg-[#08090a] text-gray-100 shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800">
              <div>
                <h2 className="text-sm font-semibold text-white">Session progress</h2>
                <p className="text-xs text-gray-500 font-mono truncate max-w-[20rem] sm:max-w-md">{terminalSessionId}</p>
              </div>
              <div className="flex items-center gap-2">
                {terminalQueueStatus && (
                  <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(terminalQueueStatus)}`}>
                    {queueStatusLabel(terminalQueueStatus)}
                  </span>
                )}
                {terminalLoading && <span className="text-xs text-gray-500">Updating…</span>}
                <button
                  type="button"
                  onClick={() => setTerminalSessionId(null)}
                  className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                >
                  Close
                </button>
              </div>
            </div>
            {terminalError && (
              <p className="px-4 py-2 text-xs text-red-400 border-b border-gray-800">{terminalError}</p>
            )}
            <div className="flex flex-1 min-h-[20rem] flex-col">
              <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.25fr_1fr]">
                <div className="flex h-full min-h-0 flex-col border-b border-gray-800 md:border-b-0 md:border-r md:border-r-gray-800">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Terminal</div>
                  {terminalLines.length === 0 && !terminalError ? (
                    <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-3 pt-0">
                      <p className="text-center text-sm text-gray-500">
                        {terminalQueueStatus === 'pending' || terminalQueueStatus == null
                          ? 'Waiting For Observatory Signal.'
                          : terminalQueueStatus === 'completed'
                            ? 'Session completed. No further live updates.'
                            : terminalQueueStatus === 'failed'
                              ? 'Session marked failed. Waiting for observatory POSTs…'
                              : 'Waiting for observatory POSTs…'}
                      </p>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
                      {terminalLines.map((line, i) => {
                        const failedLine = isSessionFailedTerminalLine(line.text)
                        return (
                          <div
                            key={`${line.at}-${i}-${line.text.slice(0, 24)}`}
                            className={`whitespace-pre-wrap break-words border-l-2 pl-2 mb-2 ${
                              failedLine ? 'border-red-600/60' : 'border-green-700/40'
                            }`}
                          >
                            <span className="text-gray-500">[{new Date(line.at).toLocaleTimeString()}]</span>{' '}
                            <span className={failedLine ? 'text-red-400 font-semibold' : 'text-green-400'}>
                              {line.text}
                            </span>
                          </div>
                        )
                      })}
                      <div ref={terminalEndRef} />
                    </div>
                  )}
                </div>
                <div className="flex h-full min-h-0 flex-col">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Latest Image</div>
                  <div className="flex-1 p-3 pt-0 flex flex-col items-center justify-center">
                    {terminalPreviewUrl ? (
                      <>
                        <img
                          src={terminalPreviewUrl}
                          alt="Latest session preview"
                          className="w-full max-h-[55vh] object-contain"
                        />
                        <p className="mt-2 w-full text-center text-xs">
                          <span className="text-gray-500">Updated on </span>
                          {terminalPreviewUpdatedAt
                            ? new Date(terminalPreviewUpdatedAt).toLocaleString()
                            : '—'}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">No Image.</p>
                    )}
                    {terminalPreviewError && <p className="mt-2 text-xs text-gray-500">{terminalPreviewError}</p>}
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Session Detail</div>
                <div className="grid gap-x-4 gap-y-2 p-3 text-xs md:grid-cols-3">
                  <p><span className="text-gray-500">Session Name: </span>{terminalSessionDetail?.target ?? '--'}</p>
                  <p><span className="text-gray-500">First Name: </span>{terminalSessionDetail?.firstName?.trim() ? terminalSessionDetail.firstName : '--'}</p>
                  <p><span className="text-gray-500">Last Name: </span>{terminalSessionDetail?.lastName?.trim() ? terminalSessionDetail.lastName : '--'}</p>
                  <p><span className="text-gray-500">Email: </span>{terminalSessionDetail?.email?.trim() ? terminalSessionDetail.email : '--'}</p>
                  <p><span className="text-gray-500">Output Mode: </span>{terminalSessionDetail?.outputMode ?? '--'}</p>
                  <p><span className="text-gray-500">Submitted At: </span>{terminalSessionDetail ? new Date(terminalSessionDetail.createdAt).toLocaleString() : '--'}</p>
                  <p>
                    <span className="text-gray-500">RA / Dec: </span>
                    {typeof terminalSessionDetail?.raHours === 'number' &&
                    typeof terminalSessionDetail?.decDeg === 'number'
                      ? formatRaDecPair(terminalSessionDetail.raHours, terminalSessionDetail.decDeg)
                      : '--'}
                  </p>
                  <p><span className="text-gray-500">Estimated Duration: </span>{formatDurationShort(terminalSessionDetail?.estimatedDurationSeconds)}</p>
                  <p className="md:col-span-3">
                    <span className="text-gray-500">Imaging Plan: </span>
                    {Array.isArray(terminalSessionDetail?.filterPlans) && terminalSessionDetail.filterPlans.length > 0
                      ? terminalSessionDetail.filterPlans
                          .map((p) => `${p.filterName} (${p.count} × ${p.exposureSeconds}s)`)
                          .join(' | ')
                      : '--'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {nightPickerProjectId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-labelledby="night-picker-title"
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
          >
            <h2 id="night-picker-title" className="text-lg font-semibold text-white">
              {nightPickerPurpose === 'download' ? 'Select session to download' : 'Select session'}
            </h2>
            {(() => {
              const projectItem = queueItems.find((x) => x.id === nightPickerProjectId)
              const projectOwned = projectItem ? sessionOwnedByMe(projectItem) : false
              const projectFilterProgress = projectItem?.projectFilterProgress ?? []
              const showProjectProgress =
                nightPickerPurpose === 'progress' &&
                projectItem?.projectMode === true &&
                projectFilterProgress.length > 0
              const pickerNights = (projectItem?.nights ?? []).filter((n) => {
                if (nightPickerPurpose === 'download') {
                  return (
                    (n.status === 'completed' || n.status === 'failed') && n.hasDownload === true
                  )
                }
                return (
                  n.status === 'scheduled' ||
                  n.status === 'in_progress' ||
                  n.status === 'completed' ||
                  n.status === 'failed' ||
                  n.status === 'on_hold'
                )
              })
              if (pickerNights.length === 0 && !showProjectProgress) {
                return (
                  <p className="text-sm text-gray-400 py-2">
                    {nightPickerPurpose === 'download'
                      ? 'No session with a download yet.'
                      : 'No Session Scheduled'}
                  </p>
                )
              }
              return (
                <>
                {pickerNights.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No Session Scheduled</p>
                ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {pickerNights.map((night) => (
                    <li key={night.id}>
                      {nightPickerPurpose === 'download' ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-600 px-3 py-2">
                          <div className="min-w-0 text-sm text-white">
                            <span className="font-medium">{nightDisplayLabel(night)}</span>
                            <span className="text-gray-400"> · {night.nightKey}</span>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const projectId = nightPickerProjectId
                              const password = projectId ? sessionPasswords[projectId] ?? '' : ''
                              if (!password && !isAdmin && !projectOwned) return
                              const err = await downloadSessionFile(night.id, password)
                              if (err) setDeleteError(err)
                            }}
                            className={`shrink-0 ${glassPillXs}`}
                          >
                            Download
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const projectId = nightPickerProjectId
                            const password = projectId ? sessionPasswords[projectId] ?? '' : ''
                            setNightPickerProjectId(null)
                            setNightPickerPurpose(null)
                            if (!password && !isAdmin && !projectOwned) {
                              setAuthModalSessionId(projectId)
                              setAuthModalAction('project_progress')
                              setAuthError('Session password required.')
                              return
                            }
                            if (password) {
                              setSessionPasswords((prev) => ({
                                ...prev,
                                [night.id]: password,
                                ...(projectId ? { [projectId]: password } : {}),
                              }))
                            }
                            setTerminalSessionId(night.id)
                          }}
                          className="w-full rounded-lg border border-gray-600 px-3 py-2 text-left text-sm text-white hover:bg-[#151616]"
                        >
                          <span className="font-medium">{nightDisplayLabel(night)}</span>
                          <span className="text-gray-400"> · {night.nightKey}</span>
                          <span
                            className={`ml-2 text-xs font-semibold uppercase ${queueStatusBadgeClass(
                              night.status === 'in_progress' ? 'in_progress' : night.status
                            )}`}
                          >
                            {queueStatusLabel(night.status)}
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                )}
                {showProjectProgress && (
                  <>
                    <h2 className="text-lg font-semibold text-white">Project progress</h2>
                    <div className="space-y-3">
                      {projectFilterProgress.map((filter) => {
                        const pct =
                          filter.total > 0
                            ? Math.min(100, Math.round((filter.captured / filter.total) * 100))
                            : 0
                        const complete = filter.captured >= filter.total
                        return (
                          <div key={filter.filterName} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="font-medium text-white">{filter.filterName}</span>
                              <span className="text-gray-400">
                                {filter.captured} / {filter.total}
                                {complete ? ' · complete' : ''}
                              </span>
                            </div>
                            <div
                              className="flex h-2.5 w-full overflow-hidden rounded-full"
                              role="progressbar"
                              aria-valuenow={filter.captured}
                              aria-valuemin={0}
                              aria-valuemax={filter.total}
                              aria-label={`${filter.filterName} frames captured`}
                            >
                              <div
                                className="h-full shrink-0 bg-emerald-500 transition-[width] duration-300"
                                style={{ width: `${pct}%` }}
                              />
                              <div className="h-full min-w-0 flex-1 bg-gray-600" aria-hidden />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
                </>
              )
            })()}
            <button
              type="button"
              onClick={() => {
                setNightPickerProjectId(null)
                setNightPickerPurpose(null)
              }}
              className={glassPillMuted}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {authModalSessionId && authModalAction && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!authModalSessionId || !authModalAction) return
              const password = authPassword.trim()
              if (!password) {
                setAuthError('Session/Admin password is required.')
                return
              }
              setAuthSubmitting(true)
              setAuthError(null)
              try {
                setSessionPasswords((prev) => ({ ...prev, [authModalSessionId]: password }))
                if (authModalAction === 'project_progress') {
                  const res = await fetch(
                    `/api/imaging/queue/${encodeURIComponent(authModalSessionId)}/progress`,
                    { headers: { 'x-session-password': password } }
                  )
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data?.ok !== true) {
                    setAuthError(typeof data.error === 'string' ? data.error : 'Invalid session password.')
                    return
                  }
                  setNightPickerProjectId(authModalSessionId)
                  setNightPickerPurpose('progress')
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'project_download') {
                  const res = await fetch(
                    `/api/imaging/queue/${encodeURIComponent(authModalSessionId)}/progress`,
                    { headers: { 'x-session-password': password } }
                  )
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data?.ok !== true) {
                    setAuthError(typeof data.error === 'string' ? data.error : 'Invalid session password.')
                    return
                  }
                  setNightPickerProjectId(authModalSessionId)
                  setNightPickerPurpose('download')
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'progress') {
                  setTerminalSessionId(authModalSessionId)
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'edit') {
                  const target = queueItems.find((x) => x.id === authModalSessionId)
                  if (!target) {
                    setAuthError('Session not found.')
                    return
                  }
                  beginEditSession(target)
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                const err = await downloadSessionFile(authModalSessionId, password)
                if (err) {
                  setAuthError(err)
                  return
                }
                setAuthModalSessionId(null)
                setAuthModalAction(null)
                setAuthPassword('')
              } finally {
                setAuthSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-white">
              {authModalAction === 'project_progress'
                ? 'Check Project Progress'
                : authModalAction === 'project_download'
                  ? 'Download Project Session'
                  : authModalAction === 'progress'
                    ? 'Check Session Progress'
                    : authModalAction === 'edit'
                      ? 'Edit Session'
                      : 'Download Session File'}
            </h2>
            {authModalAction === 'edit' && (
              <p className="text-sm text-gray-400">
                Enter session password or admin password to edit this pending session.
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session/Admin Password</span>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            {authError && <p className="text-sm text-red-400">{authError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  setAuthError(null)
                }}
                className={`${glassPillFullWidthSm} disabled:opacity-60`}
                disabled={authSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${glassPillFullWidthSm} disabled:opacity-60`}
                disabled={authSubmitting}
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!deleteTargetId) return
              const pwd = deletePassword.trim()
              const deleteTargetItem = queueItems.find((item) => item.id === deleteTargetId)
              const deleteOwned = deleteTargetItem ? sessionOwnedByMe(deleteTargetItem) : false
              if (!isAdmin && !deleteOwned && !pwd) {
                setDeleteError('Password is required.')
                return
              }
              setDeleteSubmitting(true)
              setDeleteError(null)
              try {
                await handleDeleteRequest(deleteTargetId, isAdmin || deleteOwned ? '' : pwd)
              } finally {
                setDeleteSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-white">Delete Session</h2>
            {(() => {
              const deleteTargetItem = deleteTargetId
                ? queueItems.find((item) => item.id === deleteTargetId)
                : undefined
              const deleteOwned = deleteTargetItem ? sessionOwnedByMe(deleteTargetItem) : false
              if (isAdmin || deleteOwned) {
                return (
                  <p className="text-sm text-gray-300">
                    Delete this session permanently? This cannot be undone.
                  </p>
                )
              }
              return (
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-white">Password</span>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
                  />
                </label>
              )
            })()}
            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteTargetId(null)
                  setDeletePassword('')
                  setDeleteError(null)
                }}
                className={`${glassPillMd} disabled:opacity-60`}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${glassPillDangerSolid} disabled:opacity-60`}
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showSaveRemoteSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Save Session</h2>
            <p className="text-sm text-gray-400">Save this form as a reusable template on your account.</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session name</span>
              <input
                type="text"
                value={saveModalName}
                onChange={(e) => setSaveModalName(e.target.value)}
                className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
            </label>
            {saveModalError && <p className="text-sm text-red-400">{saveModalError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowSaveRemoteSessionModal(false)
                  setSaveModalError(null)
                }}
                className={`${glassPillMd}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const name = saveModalName.trim()
                    if (!name) {
                      setSaveModalError('Session name is required.')
                      return
                    }
                    const form = captureRemoteSavedForm()
                    form.requestName = name
                    form.sessionPassword = ''
                    const result = await saveMemberSavedSession({ name, form })
                    if (!result.ok) {
                      setSaveModalError(result.error)
                      return
                    }
                    await refreshCloudSavedSessions()
                    setRequestName(name)
                    setShowSaveRemoteSessionModal(false)
                    setSaveModalError(null)
                    setSubmitError(null)
                    setSubmitSuccess(`Saved session "${name}" to your account.`)
                  })()
                }}
                className={`${glassPillMd} glass-pill-active`}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showRunRemoteSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Run A Saved Session</h2>
            {cloudSavedSessions.length > 0 ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-white">Saved templates</span>
                <select
                  value={runModalName}
                  onChange={(e) => setRunModalName(e.target.value)}
                  className="w-full appearance-none rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
                >
                  <option value="">Select…</option>
                  {cloudSavedSessions.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session name</span>
              <input
                type="text"
                value={runModalName}
                onChange={(e) => setRunModalName(e.target.value)}
                className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
            </label>
            {runModalError && <p className="text-sm text-red-400">{runModalError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowRunRemoteSessionModal(false)
                  setRunModalError(null)
                }}
                className={`${glassPillMd}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const name = runModalName.trim()
                    if (!name) {
                      setRunModalError('Session name is required.')
                      return
                    }
                    const found = await loadMemberSavedSessionByName(name)
                    if (!found) {
                      setRunModalError('No saved session with that name.')
                      return
                    }
                    applyRemoteSavedForm(found.form)
                    setShowRunRemoteSessionModal(false)
                    setRunModalError(null)
                    setSubmitError(null)
                    setSubmitSuccess(`Loaded saved session "${found.name}".`)
                  })()
                }}
                className={`${glassPillMd} glass-pill-active`}
              >
                Load
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
