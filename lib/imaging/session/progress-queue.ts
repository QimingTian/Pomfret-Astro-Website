import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getProjectById, listProjects } from '@/lib/imaging-project-store'
import { getBoardEntry, getSoleInProgressBoardId } from '@/lib/imaging-session-board'
import { progressLineText, readQueueIdFromDetail } from '@/lib/session-progress-signal'
import { getEmergencyStopState, isEmergencyStopBlocking } from './emergency-stop'

function soleInProgressNightSubId(ids: string[]): string | null {
  if (ids.length === 1) return ids[0]!
  return null
}

/** Sub-session id currently imaging for a project (at most one `in_progress` night). */
export async function getInProgressProjectNightSubId(projectId: string): Promise<string | null> {
  const project = await getProjectById(projectId)
  if (!project) return null
  return soleInProgressNightSubId(project.nights.filter((n) => n.status === 'in_progress').map((n) => n.id))
}

/** Exactly one `in_progress` sub-session across all projects (current observatory run). */
export async function getSoleInProgressProjectNightSubId(): Promise<string | null> {
  const active: string[] = []
  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (night.status === 'in_progress') active.push(night.id)
    }
  }
  return soleInProgressNightSubId(active)
}

/**
 * Legacy plain-text NINA POSTs (no queueId in body): route to the sole `in_progress` session.
 * New sequence JSON embeds queueId in every POST — that path is preferred and does not use this.
 */
export async function getActiveSessionProgressId(): Promise<string | null> {
  const boardId = await getSoleInProgressBoardId()
  if (!boardId) return null
  const board = await getBoardEntry(boardId)
  if (board?.projectMode) {
    return getInProgressProjectNightSubId(boardId)
  }
  return boardId
}

/**
 * Routes POST body to one session id. Prefer explicit `queueId` in JSON (injected at sequence build).
 * Plain-text legacy posts fall back to the sole `in_progress` session when unambiguous.
 */
export async function resolveSessionProgressQueueId(
  detail: Record<string, unknown>
): Promise<string | null> {
  const fromBody = readQueueIdFromDetail(detail)
  if (fromBody) {
    if (parseProjectNightSubId(fromBody)) return fromBody
    const project = await getProjectById(fromBody)
    if (project) {
      return getInProgressProjectNightSubId(fromBody)
    }
    return fromBody
  }

  const line = progressLineText(detail).toLowerCase()
  if (line.includes('dome closed') && (await isEmergencyStopBlocking())) {
    const estop = await getEmergencyStopState()
    if (estop?.queueId) return estop.queueId
  }

  const active = await getActiveSessionProgressId()
  if (active) return active
  return getSoleInProgressProjectNightSubId()
}
