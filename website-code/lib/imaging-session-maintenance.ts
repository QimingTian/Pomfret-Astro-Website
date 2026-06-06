import { appendAuditLog } from '@/lib/imaging-audit-log'
import { emitAgentWake, emitSiteSessionsChanged } from '@/lib/imaging/site-events'
import { compactStaleProjectBoardRows } from '@/lib/imaging-project-store'
import { purgeExpiredProjectAssets } from '@/lib/imaging-project-retention'
import { boardEnsureScheduleBarForTerminal, boardPurgeCompletedOlderThan, listBoardEntries } from '@/lib/imaging-session-board'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

const RETENTION_MS = 48 * 60 * 60 * 1000

/** Reconcile schedules, compact stale board rows, backfill schedule bars. */
export async function runImagingScheduleMaintenance(): Promise<void> {
  await reconcilePendingScheduleStatus()
  const prunedBoardIds = await compactStaleProjectBoardRows()
  for (const id of prunedBoardIds) {
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Removed stale project board row ${id} (project record missing).`,
      detail: { id, source: 'compact_stale_project_board' },
    })
  }

  const board = await listBoardEntries()
  const boardNeedsBar = board.filter(
    (b) =>
      (b.status === 'completed' || b.status === 'failed') &&
      !(typeof b.scheduleBarStartMs === 'number' && typeof b.scheduleBarEndMs === 'number')
  )
  if (boardNeedsBar.length > 0) {
    await Promise.all(boardNeedsBar.map((b) => boardEnsureScheduleBarForTerminal(b.id)))
  }
  emitSiteSessionsChanged('maintenance')
  emitAgentWake('reconcile')
}

/** Purge completed sessions / project assets older than 48h (R2 + previews). */
export async function runImagingRetentionCleanup(source: string): Promise<string[]> {
  const purgedBoardIds = await boardPurgeCompletedOlderThan(RETENTION_MS)
  for (const queueId of purgedBoardIds) {
    await deleteR2ObjectForQueueId(queueId)
    await removePreviewImage(queueId)
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Session ${queueId} deleted by retention cleanup (${source}).`,
      detail: { id: queueId, source },
    })
  }
  const purgedProjectIds = await purgeExpiredProjectAssets(RETENTION_MS)
  for (const queueId of purgedProjectIds) {
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Project assets ${queueId} deleted by retention after project completion (${source}).`,
      detail: { id: queueId, source },
    })
  }
  return Array.from(new Set([...purgedBoardIds, ...purgedProjectIds]))
}
