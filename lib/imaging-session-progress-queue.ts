import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getProjectById } from '@/lib/imaging-project-store'
import { getBoardEntry, getSoleInProgressBoardId } from '@/lib/imaging-session-board'
import { readQueueIdFromDetail } from '@/lib/session-progress-signal'

/** Sub-session id currently imaging for a project (at most one `in_progress` night). */
export async function getInProgressProjectNightSubId(projectId: string): Promise<string | null> {
  const project = await getProjectById(projectId)
  if (!project) return null
  const active = project.nights.filter((n) => n.status === 'in_progress')
  if (active.length === 1) return active[0].id
  return null
}

/**
 * The one session that receives observatory progress — same rule as normal mode:
 * the sole `in_progress` board row, or for projects the active sub-session id (not the project root).
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
 * Routes POST body to exactly one session id (normal queue/board id or `{projectId}::night-{n}`).
 * Never attributes progress to a project root id.
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
  return getActiveSessionProgressId()
}
