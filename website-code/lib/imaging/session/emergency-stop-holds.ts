import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getProjectByNightSubId, listProjects } from '@/lib/imaging-project-store'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { getRequestById, listAll } from '@/lib/imaging-queue-store'
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

  for (const row of await listAll()) {
    if (row.projectMode) continue
    if (!QUEUE_HOLDABLE.has(row.status)) continue
    const result = await setQueueSessionOnHold(row.id)
    if ('ok' in result) heldSessionIds.push(row.id)
  }

  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (!NIGHT_HOLDABLE.has(night.status)) continue
      const result = await setProjectNightOnHold(project.id, night.id, night)
      if ('ok' in result) heldSessionIds.push(night.id)
    }
  }

  await reconcilePendingScheduleStatus({ force: true })
  return heldSessionIds
}

export async function releaseEmergencyStopHolds(heldSessionIds: string[]): Promise<void> {
  for (const sessionId of heldSessionIds) {
    const nightSub = parseProjectNightSubId(sessionId)
    if (nightSub) {
      const match = await getProjectByNightSubId(sessionId)
      if (!match) continue
      if (match.night.status !== 'on_hold') continue
      await releaseProjectNightHold(match.project.id, sessionId, match.night)
      continue
    }
    const row = await getRequestById(sessionId)
    if (!row || row.status !== 'on_hold') continue
    await releaseQueueSessionHold(sessionId)
  }
  await reconcilePendingScheduleStatus({ force: true })
}
