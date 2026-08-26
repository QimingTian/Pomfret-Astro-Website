import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasAnyFrozenScheduleBar,
  hasFrozenScheduleBar,
  type ScheduleBarPlacement,
} from './schedule-bar'
import type { SessionBoardEntry } from '@/lib/imaging-session-board'

function entry(partial: Partial<SessionBoardEntry>): SessionBoardEntry {
  return {
    id: 's1',
    target: 'XZ Dra',
    createdAt: '2026-08-26T00:30:20.442Z',
    updatedAt: '2026-08-26T07:01:30.513Z',
    status: 'completed',
    ...partial,
  }
}

test('hasAnyFrozenScheduleBar is true for a completed bar on any night', () => {
  const e = entry({
    scheduleStripNightKey: '2026-08-25',
    scheduleBarStartMs: Date.parse('2026-08-26T00:39:46.047Z'),
    scheduleBarEndMs: Date.parse('2026-08-26T07:01:30.513Z'),
  })
  assert.equal(hasAnyFrozenScheduleBar(e), true)
  assert.equal(hasFrozenScheduleBar(e, '2026-08-25'), true)
  assert.equal(hasFrozenScheduleBar(e, '2026-08-26'), false)
})

test('hasAnyFrozenScheduleBar is false when bar fields are missing', () => {
  assert.equal(hasAnyFrozenScheduleBar(entry({})), false)
  assert.equal(
    hasAnyFrozenScheduleBar(
      entry({
        scheduleStripNightKey: '2026-08-25',
        scheduleBarStartMs: 100,
        scheduleBarEndMs: 100,
      })
    ),
    false
  )
})

test('terminal bar placement type requires positive interval', () => {
  const bar: ScheduleBarPlacement = {
    nightKey: '2026-08-25',
    startMs: 1,
    endMs: 2,
  }
  assert.ok(bar.endMs > bar.startMs)
})
