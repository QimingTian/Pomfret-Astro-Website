import { appendAuditLog } from '@/lib/imaging-audit-log'
import { notifyProjectNightCompletionEmail } from '@/lib/imaging-project-night-email'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { hasR2ObjectForQueueId } from '@/lib/r2-session-download'
import { getProjectByNightSubId, listProjects, markNightCompleted } from '@/lib/imaging-project-store'
import { boardMarkCompleted, getBoardEntry } from '@/lib/imaging-session-board'

/**
 * When the observatory agent registers R2 files for a project sub-session, treat the night as
 * complete if NINA never sent "Session Completed" (common gap — imaging succeeds but download stays hidden).
 */
export async function completeProjectNightAfterUpload(queueId: string): Promise<void> {
  if (!parseProjectNightSubId(queueId)) return
  const match = await getProjectByNightSubId(queueId)
  if (!match || match.night.status !== 'in_progress') return

  const result = await markNightCompleted(match.project.id, queueId)
  if (!result) return

  const completedAtIso = new Date().toISOString()
  void appendAuditLog({
    kind: 'queue.status',
    message: `Project sub-session ${queueId} completed (R2 upload registered).`,
    detail: { id: queueId, projectId: match.project.id, target: match.project.target },
  })
  void notifyProjectNightCompletionEmail(
    {
      queueId,
      target: match.project.target,
      email: match.project.email,
      firstName: match.project.firstName,
    },
    completedAtIso
  )

  if (result.projectCompleted) {
    const board = await getBoardEntry(match.project.id)
    if (board?.status === 'in_progress') {
      await boardMarkCompleted(match.project.id)
    }
  }
  void reconcilePendingScheduleStatus()
}

/** Backfill nights that finished imaging + R2 upload but never got a NINA "Session Completed" POST. */
export async function syncProjectNightsCompleteWhenR2Present(): Promise<void> {
  for (const project of await listProjects()) {
    for (const night of project.nights) {
      if (night.status !== 'in_progress') continue
      if (!(await hasR2ObjectForQueueId(night.id))) continue
      await completeProjectNightAfterUpload(night.id)
    }
  }
}
