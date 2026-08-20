import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getProjectByNightSubId, listProjects } from '@/lib/imaging-project-store'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { getRequestById, listAll } from '@/lib/imaging-queue-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import {
  releaseProjectNightHold,
  releaseQueueSessionHold,
  setProjectNightOnHold,
  setQueueSessionOnHold,
} from '@/lib/imaging/session-hold'

const QUEUE_HOLDABLE = new Set(['pending', 'scheduled'])
const NIGHT_HOLDABLE = new Set(['planned', 'scheduled'])

export async function applyEmergencyStopHolds(): Promise<string[]> {
  const heldSessionIds: string[] = []
  const skip = { skipReconcile: true as const }

  for (const row of await listAll()) {
    if (row.projectMode) continue
    if (!QUEUE_HOLDABLE.has(row.status)) continue
    const result = await setQueueSessionOnHold(row.id, skip)
    if ('ok' in result) heldSessionIds.push(row.id)
  }

  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (!NIGHT_HOLDABLE.has(night.status)) continue
      const result = await setProjectNightOnHold(project.id, night.id, night, skip)
      if ('ok' in result) heldSessionIds.push(night.id)
    }
  }

  await reconcilePendingScheduleStatus({ force: true })
  return heldSessionIds
}

export async function releaseEmergencyStopHolds(heldSessionIds: string[]): Promise<void> {
  const skip = { skipReconcile: true as const }
  for (const sessionId of heldSessionIds) {
    const nightSub = parseProjectNightSubId(sessionId)
    if (nightSub) {
      const match = await getProjectByNightSubId(sessionId)
      if (!match) continue
      if (match.night.status !== 'on_hold') continue
      await releaseProjectNightHold(match.project.id, sessionId, match.night, skip)
      continue
    }
    const row = await getRequestById(sessionId)
    if (!row || row.status !== 'on_hold') continue
    await releaseQueueSessionHold(sessionId, skip)
  }
  /* One force reconcile after all rows are pending/planned again. */
  await reconcilePendingScheduleStatus({ force: true })
}

function projectHasFailedSubTonight(
  project: Awaited<ReturnType<typeof listProjects>>[number],
  nightKey: string
): boolean {
  return project.nights.some((n) => n.nightKey === nightKey && n.status === 'failed')
}

/** Release auto-holds from failed_sub_tonight (not tracked in ESTOP heldSessionIds). */
export async function releaseFailedSubTonightAutoHolds(): Promise<string[]> {
  const releasedSessionIds: string[] = []
  const skip = { skipReconcile: true as const }
  const nightKey = getTonightScheduleStrip().nightKey

  for (const project of await listProjects()) {
    if (!projectHasFailedSubTonight(project, nightKey)) continue
    for (const night of project.nights) {
      if (night.nightKey !== nightKey || night.status !== 'on_hold') continue
      const match = await getProjectByNightSubId(night.id)
      if (!match || match.night.status !== 'on_hold') continue
      const result = await releaseProjectNightHold(match.project.id, night.id, match.night, skip)
      if ('ok' in result) releasedSessionIds.push(night.id)
    }
  }

  if (releasedSessionIds.length) {
    await reconcilePendingScheduleStatus({ force: true })
  }

  return releasedSessionIds
}
