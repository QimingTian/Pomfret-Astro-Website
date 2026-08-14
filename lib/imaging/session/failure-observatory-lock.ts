import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  armEmergencyStop,
  getEmergencyStopState,
  isEmergencyStopBlocking,
  updateEmergencyStopHeldSessionIds,
} from '@/lib/imaging-emergency-stop'
import { applyEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import { setObservatoryMode, setObservatoryStatus } from '@/lib/observatory-status-store'

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
 * After a real session failure: immediately lock Manual + Closed — Maintenance,
 * hold remaining work, and arm ESTOP so the agent still closes the dome.
 * Status must not wait for the dome-closed progress line.
 */
export async function lockObservatoryAfterSessionFailure(reason: string): Promise<void> {
  if (!shouldLockObservatoryOnSessionFailure(reason)) return

  try {
    await setObservatoryMode('manual')
    await setObservatoryStatus('closed_observatory_maintenance')
    void appendAuditLog({
      kind: 'queue.status',
      message: `Session failure (${reason}): observatory locked to manual Closed — Maintenance.`,
      detail: { reason },
    })
  } catch (error) {
    void appendAuditLog({
      kind: 'queue.status',
      message: `Session failure (${reason}): failed to lock observatory mode/status.`,
      detail: { reason, error: error instanceof Error ? error.message : String(error) },
    })
  }

  try {
    const heldSessionIds = await applyEmergencyStopHolds()

    if (await isEmergencyStopBlocking()) {
      const state = await getEmergencyStopState()
      if (state && heldSessionIds.length > state.heldSessionIds.length) {
        const merged = Array.from(new Set(state.heldSessionIds.concat(heldSessionIds)))
        await updateEmergencyStopHeldSessionIds(merged)
      }
      void appendAuditLog({
        kind: 'queue.status',
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
      kind: 'emergency_stop',
      message: newlyArmed
        ? `Session failure (${reason}): observatory stop armed (${state.queueId}); ${heldSessionIds.length} session(s) on hold; dome close pending.`
        : `Session failure (${reason}): observatory stop already armed (${state.queueId}).`,
      detail: { reason, queueId: state.queueId, heldSessionIds, newlyArmed },
    })
  } catch (error) {
    void appendAuditLog({
      kind: 'queue.status',
      message: `Session failure (${reason}): observatory locked but ESTOP/hold follow-up failed.`,
      detail: { reason, error: error instanceof Error ? error.message : String(error) },
    })
  }
}
