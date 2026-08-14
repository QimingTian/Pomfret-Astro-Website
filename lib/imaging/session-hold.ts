import { appendAuditLog } from '@/lib/imaging-audit-log'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import {
  getProjectByNightSubId,
  patchProject,
  type ProjectNight,
  type ProjectNightStatus,
} from '@/lib/imaging-project-store'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import {
  getRequestById,
  patchRequestOnHold,
  releaseRequestOnHold,
  type ImagingRequestStatus,
} from '@/lib/imaging-queue-store'

export type QueueHoldFromStatus = 'pending' | 'scheduled'
export type ProjectNightHoldFromStatus = 'planned' | 'scheduled'
export type SessionHoldOptions = {
  /** Batch ESTOP hold/release: one reconcile at the end instead of per row. */
  skipReconcile?: boolean
}

const QUEUE_HOLDABLE = new Set<ImagingRequestStatus>(['pending', 'scheduled'])
const NIGHT_HOLDABLE = new Set<ProjectNightStatus>(['planned', 'scheduled'])

export async function setQueueSessionOnHold(
  sessionId: string,
  options?: SessionHoldOptions
): Promise<{ ok: true } | { error: string }> {
  const current = await getRequestById(sessionId)
  if (!current) return { error: 'Session not found' }
  if (current.projectMode) {
    return { error: 'Use the project sub-session id (Session N), not the project queue id.' }
  }
  if (!QUEUE_HOLDABLE.has(current.status)) {
    return { error: `Cannot hold session in status "${current.status}".` }
  }

  const updated = await patchRequestOnHold(sessionId, {
    fromStatus: current.status as QueueHoldFromStatus,
  })
  if (!updated) return { error: 'Could not hold session.' }

  void appendAuditLog({
    kind: 'queue.on_hold',
    message: `Session placed on hold: ${updated.target} (${sessionId}).`,
    detail: { sessionId, previousStatus: current.status },
  })
  if (!options?.skipReconcile) await reconcilePendingScheduleStatus({ force: true })
  return { ok: true }
}

export async function releaseQueueSessionHold(
  sessionId: string,
  options?: SessionHoldOptions
): Promise<{ ok: true } | { error: string }> {
  const current = await getRequestById(sessionId)
  if (!current) return { error: 'Session not found' }
  if (current.status !== 'on_hold') {
    return { error: 'Session is not on hold.' }
  }

  const updated = await releaseRequestOnHold(sessionId)
  if (!updated) return { error: 'Could not release session hold.' }

  void appendAuditLog({
    kind: 'queue.on_hold',
    message: `Session hold released: ${updated.target} (${sessionId}).`,
    detail: {
      sessionId,
      restoredStatus: updated.status,
      previousHoldFrom: current.onHoldFromStatus ?? null,
    },
  })
  if (!options?.skipReconcile) await reconcilePendingScheduleStatus({ force: true })
  return { ok: true }
}

export async function setProjectNightOnHold(
  projectId: string,
  nightId: string,
  night: ProjectNight,
  options?: SessionHoldOptions
): Promise<{ ok: true } | { error: string }> {
  if (!NIGHT_HOLDABLE.has(night.status)) {
    const label = night.status === 'planned' ? 'scheduled' : night.status
    return { error: `Cannot hold sub-session in status "${label}".` }
  }

  const project = (await getProjectByNightSubId(nightId))?.project
  if (!project) return { error: 'Sub-session not found' }
  const nights = project.nights.map((n) =>
    n.id === nightId
      ? {
          ...n,
          status: 'on_hold' as const,
          onHoldFromStatus: n.status as ProjectNightHoldFromStatus,
          plannedStartIso: null,
          adminForceRunUntilIso: null,
          scheduleStripNightKey: null,
          scheduleBarStartMs: null,
          scheduleBarEndMs: null,
        }
      : n
  )
  const updated = await patchProject(projectId, { nights })
  if (!updated) return { error: 'Could not hold sub-session.' }

  void appendAuditLog({
    kind: 'queue.on_hold',
    message: `Project sub-session placed on hold: ${updated.target} Session ${night.nightIndex} (${nightId}).`,
    detail: { sessionId: nightId, projectId, previousStatus: night.status },
  })
  if (!options?.skipReconcile) await reconcilePendingScheduleStatus({ force: true })
  return { ok: true }
}

export async function releaseProjectNightHold(
  projectId: string,
  nightId: string,
  night: ProjectNight,
  options?: SessionHoldOptions
): Promise<{ ok: true } | { error: string }> {
  if (night.status !== 'on_hold') {
    return { error: 'Sub-session is not on hold.' }
  }
  /* Always planned — reconcile reuses this same sub as scheduled (does not mint a later index). */
  const restore: ProjectNightStatus = 'planned'

  const project = (await getProjectByNightSubId(nightId))?.project
  if (!project) return { error: 'Sub-session not found' }
  const nights = project.nights.map((n) =>
    n.id === nightId
      ? {
          ...n,
          status: restore,
          onHoldFromStatus: undefined,
          plannedStartIso: null,
          scheduleStripNightKey: null,
          scheduleBarStartMs: null,
          scheduleBarEndMs: null,
        }
      : n
  )
  const updated = await patchProject(projectId, { nights })
  if (!updated) return { error: 'Could not release sub-session hold.' }

  void appendAuditLog({
    kind: 'queue.on_hold',
    message: `Project sub-session hold released: ${updated.target} Session ${night.nightIndex} (${nightId}).`,
    detail: { sessionId: nightId, projectId, restoredStatus: restore },
  })
  if (!options?.skipReconcile) await reconcilePendingScheduleStatus({ force: true })
  return { ok: true }
}

export async function adminHoldSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    return setProjectNightOnHold(match.project.id, sessionId, match.night)
  }
  return setQueueSessionOnHold(sessionId)
}

export async function adminReleaseSessionHold(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const nightSub = parseProjectNightSubId(sessionId)
  if (nightSub) {
    const match = await getProjectByNightSubId(sessionId)
    if (!match) return { error: 'Sub-session not found' }
    return releaseProjectNightHold(match.project.id, sessionId, match.night)
  }
  return releaseQueueSessionHold(sessionId)
}
