import { useCallback, useState } from 'react'
import { deleteSession } from '../../lib/hub-client'
import {
  queueStatusBadgeClass,
  queueStatusLabel,
  sessionActionButtonClass,
} from '../../lib/imaging/queue-status'
import type { SessionRow } from '../../lib/types'
type ScheduleSectionProps = {
  sessions: SessionRow[]
  loading: boolean
  error: string | null
  hubReachable: boolean
  onRefresh?: () => void
  onEditSession?: (session: SessionRow) => void
  onCheckProgress?: (session: SessionRow) => void
}

function sessionTypeLabel(row: SessionRow): string {
  if (row.sessionType === 'variable_star') return 'Variable Star'
  return 'Deep Sky Object'
}

function projectLabel(row: SessionRow): string {
  return row.projectMode ? ' · Project Mode' : ''
}

export function ScheduleSection({
  sessions,
  loading,
  error,
  hubReachable,
  onRefresh,
  onEditSession,
  onCheckProgress,
}: ScheduleSectionProps) {
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const actionsEnabled = hubReachable

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return
    setDeleteSubmitting(true)
    setDeleteError(null)
    try {
      const result = await deleteSession(deleteTargetId)
      if (!result.ok) {
        setDeleteError(result.error ?? 'Unable to delete session')
        return
      }
      setDeleteTargetId(null)
      onRefresh?.()
    } catch (ex) {
      setDeleteError(ex instanceof Error ? ex.message : 'Unable to delete session')
    } finally {
      setDeleteSubmitting(false)
    }
  }, [deleteTargetId, onRefresh])

  return (
    <section className="remote-glass-pane schedule-panel">
      <div className="remote-pane-head">
        <h2>Current Sessions</h2>
      </div>

      <div className="session-queue-wrap">
        {error && <p className="panel-error">{error}</p>}
        {deleteError && !deleteTargetId && <p className="panel-error">{deleteError}</p>}

        {loading && sessions.length === 0 ? (
          <p className="session-queue-empty">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="session-queue-empty">No sessions.</p>
        ) : (
          <ul className="session-queue-list">
            {sessions.map((item) => {
              const displayStatus = item.status === 'claimed' ? 'in_progress' : item.status
              const showDownloadButton = item.projectMode
                ? false
                : item.hasDownload === true ||
                  (item.outputMode !== 'none' &&
                    item.outputMode !== undefined &&
                    displayStatus === 'completed')
              const canEdit = displayStatus === 'pending' || displayStatus === 'scheduled'

              return (
                <li key={item.id} className="session-queue-item">
                  <div className="session-queue-item-head">
                    <span className="session-queue-title">{`${item.target} | ${sessionTypeLabel(item)}${projectLabel(item)}`}</span>
                    <span className={`queue-status-badge ${queueStatusBadgeClass(displayStatus)}`}>
                      {queueStatusLabel(displayStatus)}
                    </span>
                  </div>
                  <div className="session-queue-actions">
                    {showDownloadButton && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        className={sessionActionButtonClass(actionsEnabled)}
                        onClick={() =>
                          setDeleteError('Download will be available when the observatory publishes session files.')
                        }
                      >
                        Download file
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      className={sessionActionButtonClass(actionsEnabled)}
                      onClick={() => onCheckProgress?.(item)}
                    >
                      Check progress
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        className={sessionActionButtonClass(actionsEnabled)}
                        onClick={() => onEditSession?.(item)}
                      >
                        Edit session
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      className={sessionActionButtonClass(actionsEnabled, 'danger')}
                      onClick={() => {
                        setDeleteError(null)
                        setDeleteTargetId(item.id)
                      }}
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

      {deleteTargetId && (
        <div
          className="session-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (deleteSubmitting) return
            setDeleteTargetId(null)
            setDeleteError(null)
          }}
        >
          <div
            className="session-delete-modal"
            role="dialog"
            aria-labelledby="delete-session-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-session-title">Delete Session</h2>
            <p className="session-delete-copy">Delete this session permanently? This cannot be undone.</p>
            {deleteError && <p className="panel-error">{deleteError}</p>}
            <div className="session-delete-actions">
              <button
                type="button"
                className="session-action-btn"
                disabled={deleteSubmitting}
                onClick={() => {
                  setDeleteTargetId(null)
                  setDeleteError(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="session-action-btn danger solid"
                disabled={deleteSubmitting}
                onClick={() => void handleDeleteConfirm()}
              >
                {deleteSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  )
}
