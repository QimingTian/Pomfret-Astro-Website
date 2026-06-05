/**
 * One-off ops: mark a project sub-session completed in production KV (enables download UI).
 * Usage: npx tsx scripts/complete-project-night-sub.ts '<projectId>::night-N'
 */
import { appendAuditLog } from '../lib/imaging-audit-log'
import { publishProgress } from '../lib/imaging-progress-live'
import { getProjectByNightSubId, markNightCompleted } from '../lib/imaging/project/store'
import { getR2ObjectKey, hasR2ObjectForQueueId } from '../lib/r2-session-download'
import { boardMarkCompleted, getBoardEntry } from '../lib/imaging/session/board'

async function main() {
  const sessionId = process.argv[2]?.trim()
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/complete-project-night-sub.ts <night-sub-id>')
    process.exit(1)
  }

  const match = await getProjectByNightSubId(sessionId)
  if (!match) {
    console.error('Sub-session not found:', sessionId)
    process.exit(1)
  }

  const hasR2 = await hasR2ObjectForQueueId(sessionId)
  const objectKey = hasR2 ? await getR2ObjectKey(sessionId) : null

  console.log('Before:', {
    status: match.night.status,
    nightIndex: match.night.nightIndex,
    hasR2,
    objectKey,
  })

  if (match.night.status === 'completed') {
    console.log('Already completed — download should be visible if R2 exists.')
    process.exit(0)
  }

  const result = await markNightCompleted(match.project.id, sessionId)
  if (!result) {
    console.error('markNightCompleted failed')
    process.exit(1)
  }

  publishProgress(sessionId, { type: 'status', queueStatus: 'completed' })
  await appendAuditLog({
    kind: 'queue.status',
    message: `Admin marked project sub-session ${sessionId} completed.`,
    detail: {
      sessionId,
      projectId: match.project.id,
      nightIndex: match.night.nightIndex,
      source: 'scripts/complete-project-night-sub.ts',
    },
  })

  if (result.projectCompleted) {
    const board = await getBoardEntry(match.project.id)
    if (board?.status === 'in_progress') {
      await boardMarkCompleted(match.project.id)
    }
    publishProgress(match.project.id, { type: 'status', queueStatus: 'completed' })
  }

  const after = await getProjectByNightSubId(sessionId)
  console.log('After:', {
    status: after?.night.status,
    projectStatus: after?.project.status,
    hasR2: await hasR2ObjectForQueueId(sessionId),
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
