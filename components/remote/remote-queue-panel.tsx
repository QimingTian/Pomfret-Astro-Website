'use client'

import { queueStatusBadgeClass } from '@/lib/remote/ui-status'
import { queueStatusLabel } from '@/lib/remote/queue-status'

const POMFRET_CALIBRATION_LIBRARY_DRIVE_URL =
  'https://drive.google.com/drive/folders/1nWZly4-op0yazXUoyr8sAAB9Rm8Jl2D4'

export type RemoteQueuePanelItem = {
  id: string
  target: string
  status: string
  createdAt: string
  userId?: string | null
  email?: string | null
  sessionType?: 'dso' | 'variable_star'
  projectMode?: boolean
  mosaicMode?: boolean
  adminApprovalPending?: boolean
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  hasDownload?: boolean
  nights?: Array<{ hasDownload?: boolean }>
}

type Props<T extends RemoteQueuePanelItem = RemoteQueuePanelItem> = {
  queueItems: T[]
  deleteError: string | null
  canInteractWithSession: (item: T) => boolean
  sessionActionButtonClass: (enabled: boolean, variant?: 'default' | 'danger') => string
  onDownloadClick: (item: T) => void
  onCheckProgressClick: (item: T) => void
  onEditSessionClick: (item: T) => void
  onDeleteSessionClick: (item: T) => void
}

export function RemoteQueuePanel<T extends RemoteQueuePanelItem>({
  queueItems,
  deleteError,
  canInteractWithSession,
  sessionActionButtonClass,
  onDownloadClick,
  onCheckProgressClick,
  onEditSessionClick,
  onDeleteSessionClick,
}: Props<T>) {
  return (
    <section className="max-w-3xl min-w-0">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Current Sessions</h1>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This list includes every session that is pending, scheduled, in progress, or completed. Single-night
          sessions are kept for{' '}
          <span className="font-semibold text-red-600 dark:text-red-400">48 hours</span> after they finish.
          Project Mode keeps every completed sub-session download available until the{' '}
          <span className="font-semibold text-red-600 dark:text-red-400">entire project</span> is done; then all
          project files are removed 48 hours after that. When your session finishes, you will receive an
          email—please download your data while it is still available. For the observatory master calibration library
          (bias, darks, flats),{' '}
          <a
            href={POMFRET_CALIBRATION_LIBRARY_DRIVE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-green-600 underline decoration-green-600/70 underline-offset-2 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300"
          >
            here
          </a>
          .
        </p>
        {queueItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500">No sessions.</p>
        ) : (
          <ul className="space-y-2">
            {queueItems.map((item) => {
              const displayStatus = item.status === 'claimed' ? 'in_progress' : item.status
              const statusLabel =
                item.adminApprovalPending === true && displayStatus === 'pending'
                  ? 'Awaiting admin approval'
                  : queueStatusLabel(displayStatus)
              const sessionTypeLabel = item.sessionType === 'variable_star' ? 'Variable Star' : 'Deep Sky Object'
              const projectLabel = item.mosaicMode
                ? ' · Mosaic Project Mode'
                : item.projectMode
                  ? ' · Project Mode'
                  : ''
              const projectHasDownloads =
                item.projectMode === true &&
                item.outputMode !== 'none' &&
                (item.nights?.some((n) => n.hasDownload === true) ?? false)
              const showDownloadButton = item.projectMode ? projectHasDownloads : item.hasDownload === true
              const actionsEnabled = canInteractWithSession(item)
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-white">{`${item.target} | ${sessionTypeLabel}${projectLabel}`}</span>
                    <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(displayStatus)}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {showDownloadButton && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        onClick={() => void onDownloadClick(item)}
                        className={sessionActionButtonClass(actionsEnabled)}
                      >
                        Download file
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      onClick={() => void onCheckProgressClick(item)}
                      className={sessionActionButtonClass(actionsEnabled)}
                    >
                      Check progress
                    </button>
                    {(item.status === 'pending' || item.status === 'scheduled') && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        onClick={() => onEditSessionClick(item)}
                        className={sessionActionButtonClass(actionsEnabled)}
                      >
                        Edit session
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      onClick={() => onDeleteSessionClick(item)}
                      className={sessionActionButtonClass(actionsEnabled, 'danger')}
                    >
                      Delete session
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {deleteError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
    </section>
  )
}
