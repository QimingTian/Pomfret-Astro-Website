import { useCallback, useEffect, useState } from 'react'
import {
  fetchEmergencyStopStatus,
  fetchSessionDownloadUrl,
  postSessionControlAction,
  type SessionControlAction,
} from '../../lib/hub-client'
import {
  queueStatusBadgeClass,
  queueStatusLabel,
  sessionActionButtonClass,
} from '../../lib/imaging/queue-status'
import type { SessionRow } from '../../lib/types'
import { MotionExpand } from '../motion'
import { SessionStatusPills } from './SessionStatusPills'

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
  const [panelError, setPanelError] = useState<string | null>(null)
  const [statusEditId, setStatusEditId] = useState<string | null>(null)
  const [statusActionId, setStatusActionId] = useState<string | null>(null)
  const [emergencyStopBlocking, setEmergencyStopBlocking] = useState(false)

  const actionsEnabled = hubReachable

  useEffect(() => {
    if (!hubReachable) {
      setEmergencyStopBlocking(false)
      return
    }
    let cancelled = false
    void fetchEmergencyStopStatus()
      .then((data) => {
        if (cancelled) return
        const phase = data.phase
        setEmergencyStopBlocking(phase === 'stopping' || phase === 'stopped')
      })
      .catch(() => {
        if (!cancelled) setEmergencyStopBlocking(false)
      })
    return () => {
      cancelled = true
    }
  }, [hubReachable, sessions, statusEditId])

  const runStatusAction = useCallback(
    async (sessionId: string, action: SessionControlAction) => {
      setStatusActionId(sessionId)
      setPanelError(null)
      try {
        const result = await postSessionControlAction(sessionId, action)
        if (!result.ok) {
          setPanelError(result.error ?? 'Unable to update session status')
          return
        }
        if (action === 'delete') {
          setStatusEditId(null)
        }
        onRefresh?.()
      } catch (ex) {
        setPanelError(ex instanceof Error ? ex.message : 'Unable to update session status')
      } finally {
        setStatusActionId(null)
      }
    },
    [onRefresh]
  )

  return (
    <section className="remote-glass-pane schedule-panel">
      <div className="remote-pane-head">
        <h2>Current Sessions</h2>
      </div>

      <div className="session-queue-wrap">
        {error && <p className="panel-error">{error}</p>}
        {panelError && <p className="panel-error">{panelError}</p>}

        {loading && sessions.length === 0 ? (
          <p className="session-queue-empty">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="session-queue-empty">No sessions.</p>
        ) : (
          <ul className="session-queue-list">
            {sessions.map((item) => {
              const displayStatus = item.status === 'claimed' ? 'in_progress' : item.status
              const showDownloadButton = !item.projectMode && item.hasDownload === true
              const canEdit = displayStatus === 'pending' || displayStatus === 'scheduled'
              const editingStatus = statusEditId === item.id
              const busy = statusActionId === item.id

              return (
                <li
                  key={item.id}
                  className={`session-queue-item${editingStatus ? ' session-queue-item-editing' : ''}`}
                >
                  <div className="session-queue-item-head">
                    <span className="session-queue-title">{`${item.target} | ${sessionTypeLabel(item)}${projectLabel(item)}`}</span>
                    <span className={`queue-status-badge ${queueStatusBadgeClass(displayStatus)}`}>
                      {queueStatusLabel(displayStatus)}
                    </span>
                  </div>

                  <MotionExpand open={editingStatus}>
                    <SessionStatusPills
                      status={displayStatus}
                      busy={busy}
                      emergencyStopBlocking={emergencyStopBlocking}
                      onAction={(action) => void runStatusAction(item.id, action)}
                    />
                  </MotionExpand>

                  <div className="session-queue-actions">
                    {showDownloadButton && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        className={sessionActionButtonClass(actionsEnabled)}
                        onClick={() => {
                          void (async () => {
                            setPanelError(null)
                            try {
                              const url = await fetchSessionDownloadUrl(item.id)
                              window.open(url, '_blank', 'noopener,noreferrer')
                            } catch (ex) {
                              setPanelError(ex instanceof Error ? ex.message : 'Download failed.')
                            }
                          })()
                        }}
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
                      className={sessionActionButtonClass(actionsEnabled, editingStatus ? 'default' : 'default')}
                      aria-pressed={editingStatus}
                      onClick={() => {
                        setPanelError(null)
                        setStatusEditId((prev) => (prev === item.id ? null : item.id))
                      }}
                    >
                      {editingStatus ? 'Close status' : 'Edit status'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
