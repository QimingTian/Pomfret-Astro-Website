import { useCallback, useEffect, useState } from 'react'
import { armEmergencyStop, fetchEmergencyStopStatus } from '../../lib/hub-client'

type EmergencyStopPhase = 'idle' | 'stopping' | 'stopped'

type EmergencyStopStatus = {
  phase: EmergencyStopPhase
  progress: number
  label: string
  agentConnected: boolean
  canArm: boolean
}

function emergencyStopButtonLabel(status: EmergencyStopStatus): string {
  if (status.phase === 'stopping') return 'STOPPING'
  if (status.phase === 'stopped') return 'STOPPED'
  return 'Emergency STOP'
}

export function EmergencyStopPanel({ hubReachable }: { hubReachable: boolean }) {
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
    if (!hubReachable) {
      setStatusLoaded(true)
      setStatus((prev) => ({ ...prev, agentConnected: false, canArm: false }))
      return
    }
    try {
      const data = await fetchEmergencyStopStatus()
      if (!data.ok) {
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
  }, [hubReachable])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!hubReachable) return undefined
    const intervalMs = status.phase === 'stopping' ? 3000 : 8000
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [hubReachable, refreshStatus, status.phase])

  async function confirmEmergencyStop() {
    setShowConfirm(false)
    setPending(true)
    setError(null)
    try {
      const data = await armEmergencyStop()
      if (!data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Emergency STOP failed.')
        return
      }
      setStatus({
        phase:
          data.phase === 'stopping' || data.phase === 'stopped' || data.phase === 'idle'
            ? data.phase
            : 'stopping',
        progress: typeof data.progress === 'number' ? data.progress : 33,
        label: typeof data.label === 'string' ? data.label : 'STOPPING',
        agentConnected: Boolean(data.agentConnected),
        canArm: Boolean(data.canArm),
      })
    } catch {
      setError('Emergency STOP failed.')
    } finally {
      setPending(false)
    }
  }

  const disabled =
    !hubReachable ||
    !statusLoaded ||
    pending ||
    status.phase !== 'idle' ||
    !status.agentConnected ||
    !status.canArm

  return (
    <>
      <div className="console-header-estop-inner">
        <button
          type="button"
          className="estop-pill"
          disabled={disabled}
          onClick={() => setShowConfirm(true)}
        >
          <div
            className="estop-pill-progress"
            style={{ width: `${status.progress}%` }}
            aria-hidden
          />
          <span className="estop-pill-label">
            {!statusLoaded
              ? 'Loading…'
              : pending
                ? 'Sending…'
                : emergencyStopButtonLabel(status)}
          </span>
        </button>
        {error ? <p className="estop-error">{error}</p> : null}
      </div>

      {showConfirm ? (
        <div className="estop-confirm-backdrop">
          <div role="dialog" aria-labelledby="estop-confirm-title" className="estop-confirm-dialog">
            <p id="estop-confirm-title" className="estop-confirm-text">
              ESTOP will kill any ongoing observatory work and close the dome.
            </p>
            <div className="estop-confirm-actions">
              <button
                type="button"
                disabled={pending}
                className="estop-confirm-primary"
                onClick={() => void confirmEmergencyStop()}
              >
                Confirm ESTOP
              </button>
              <button
                type="button"
                disabled={pending}
                className="estop-confirm-secondary"
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
