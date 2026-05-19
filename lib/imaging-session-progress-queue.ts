import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getProjectById } from '@/lib/imaging-project-store'
import { getBoardEntry, getSoleInProgressBoardId } from '@/lib/imaging-session-board'
import { readQueueIdFromDetail } from '@/lib/session-progress-signal'

/** Night sub-id currently imaging for a project (at most one in_progress night). */
export async function getInProgressProjectNightSubId(projectId: string): Promise<string | null> {
  const project = await getProjectById(projectId)
  if (!project) return null
  const active = project.nights.filter((n) => n.status === 'in_progress')
  if (active.length === 1) return active[0].id
  return null
}

/**
 * Resolves which session id should receive progress lines and completion handling.
 * NINA templates often POST plain `Session Completed` without queueId; the board row uses
 * the project root id while sub-sessions use `{projectId}::night-{n}`.
 */
export async function resolveSessionProgressQueueId(
  detail: Record<string, unknown>
): Promise<string | null> {
  let queueId = readQueueIdFromDetail(detail)
  if (queueId) {
    if (!parseProjectNightSubId(queueId)) {
      const nightId = await getInProgressProjectNightSubId(queueId)
      if (nightId) return nightId
    }
    return queueId
  }

  const boardId = await getSoleInProgressBoardId()
  if (!boardId) return null

  const board = await getBoardEntry(boardId)
  if (board?.projectMode || !parseProjectNightSubId(boardId)) {
    const nightId = await getInProgressProjectNightSubId(boardId)
    if (nightId) return nightId
  }

  return boardId
}
