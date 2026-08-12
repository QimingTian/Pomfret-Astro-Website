import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  armEmergencyStop,
  getEmergencyStopState,
  isEmergencyStopBlocking,
  markEmergencyStopCompleted,
  updateEmergencyStopHeldSessionIds,
} from '@/lib/imaging-emergency-stop'
import { applyEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import {
  isObservatoryAgentConnected,
  setObservatoryMode,
  setObservatoryStatus,
} from '@/lib/observatory-status-store'

/** Fail reasons that already run ESTOP or are intentional handoffs — do not arm again. */
const SKIP_LOCK_REASONS = new Set([
  'emergency_stop',
  'interrupted_before_new_nina_delivery',
  'interrupted_before_admin_force_run_delivery',
])

export const ADMIN_MARK_SESSION_FAILED_REASON = 'admin_mark_failed'

export function shouldLockObservatoryOnSessionFailure(reason: string): boolean {
  return !SKIP_LOCK_REASONS.has(reason)
}

/**
 * After a real session failure: hold pending/scheduled work, arm ESTOP (dome close),
 * then lock manual Closed — Maintenance when the dome closes (or immediately if agent is offline).
 */
export async function lockObservatoryAfterSessionFailure(reason: string): Promise<void> {
  if (!shouldLockObservatoryOnSessionFailure(reason)) return

  const heldSessionIds = await applyEmergencyStopHolds()

  if (await isEmergencyStopBlocking()) {
    const state = await getEmergencyStopState()
    if (state && heldSessionIds.length > state.heldSessionIds.length) {
      const merged = [...new Set([...state.heldSessionIds, ...heldSessionIds])]
      await updateEmergencyStopHeldSessionIds(merged)
    }
    void appendAuditLog({
      kind: 'session.progress',
      message: `Session failure (${reason}): refreshed holds while observatory stop already active (${heldSessionIds.length} session(s)).`,
      detail: { reason, heldSessionIds },
    })
    return
  }

  const actorLabel = `session_failure:${reason}`
  const { state, newlyArmed } = await armEmergencyStop(actorLabel, heldSessionIds)
  if (newlyArmed && heldSessionIds.length !== state.heldSessionIds.length) {
    await updateEmergencyStopHeldSessionIds(heldSessionIds)
  }

  void appendAuditLog({
    kind: 'session.progress',
    message: newlyArmed
      ? `Session failure (${reason}): observatory stop armed (${state.queueId}); ${heldSessionIds.length} session(s) on hold pending dome close.`
      : `Session failure (${reason}): observatory stop already armed (${state.queueId}).`,
    detail: { reason, queueId: state.queueId, heldSessionIds, newlyArmed },
  })

  const agentConnected = await isObservatoryAgentConnected()
  if (!agentConnected && newlyArmed) {
    await setObservatoryMode('manual')
    await setObservatoryStatus('closed_observatory_maintenance')
    await markEmergencyStopCompleted(state.queueId)
    void appendAuditLog({
      kind: 'session.progress',
      message: `Session failure (${reason}): agent offline — observatory locked to manual Closed — Maintenance without waiting for dome close.`,
      detail: { reason, queueId: state.queueId },
    })
  }
}
