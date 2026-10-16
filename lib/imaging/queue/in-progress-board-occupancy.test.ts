import assert from 'node:assert/strict'
import test from 'node:test'
import { collectInProgressBoardOccupancy } from '@/lib/imaging/queue/in-progress-board-occupancy'
import type { SessionBoardEntry } from '@/lib/imaging-session-board'

const baseMs = 1_800_000_000_000
const hour = 3_600_000
const nightKey = '2026-10-15'

function row(overrides: Partial<SessionBoardEntry> = {}): SessionBoardEntry {
  return {
    id: 'single', target: 'Sh2-187 Add On', status: 'in_progress',
    createdAt: new Date(baseMs - hour).toISOString(),
    updatedAt: new Date(baseMs).toISOString(),
    plannedStartIso: new Date(baseMs).toISOString(),
    downloadedAt: new Date(baseMs + 1000).toISOString(),
    estimatedDurationSeconds: 4 * 3600,
    ...overrides,
  }
}

test('in-progress single-night board entry reserves its full remaining window', () => {
  const result = collectInProgressBoardOccupancy(
    [row()], nightKey, baseMs, baseMs + 8 * hour, baseMs + hour
  )
  assert.equal(result.length, 1)
  assert.equal(result[0]?.startMs, baseMs + 1000)
  assert.equal(result[0]?.endMs, baseMs + 4 * hour + 1000)
})

test('project parent and terminal board rows are not double counted', () => {
  const result = collectInProgressBoardOccupancy(
    [row({ projectMode: true }), row({ id: 'done', status: 'completed' })],
    nightKey, baseMs, baseMs + 8 * hour, baseMs + hour
  )
  assert.deepEqual(result, [])
})

test('overrunning in-progress entry reserves the remainder of tonight', () => {
  const result = collectInProgressBoardOccupancy(
    [row({ estimatedDurationSeconds: 3600 })],
    nightKey, baseMs, baseMs + 8 * hour, baseMs + 2 * hour
  )
  assert.equal(result[0]?.endMs, baseMs + 8 * hour)
})
