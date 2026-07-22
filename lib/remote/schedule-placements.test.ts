import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completedSessionOverlapsTonightStripWindow,
  fallbackPlacementForTerminalSession,
  imagingWindowStartMs,
  inProgressSchedulePlacement,
  listScheduledPendingPlacements,
  placementToTimelineBlock,
  serverScheduleBarForNight,
  sessionDurationMsFromItem,
  type ScheduledStripItem,
} from './schedule-placements'

const baseItem = {
  id: 's1',
  status: 'scheduled',
  createdAt: '2026-07-21T22:00:00.000Z',
  target: 'M42',
} satisfies ScheduledStripItem

test('serverScheduleBarForNight rejects wrong nightKey and invalid bar', () => {
  assert.equal(
    serverScheduleBarForNight(
      { ...baseItem, scheduleStripNightKey: '2026-07-21', scheduleBarStartMs: 100, scheduleBarEndMs: 200 },
      '2026-07-22'
    ),
    null
  )
  assert.equal(
    serverScheduleBarForNight(
      { ...baseItem, scheduleStripNightKey: '2026-07-21', scheduleBarStartMs: 200, scheduleBarEndMs: 200 },
      '2026-07-21'
    ),
    null
  )
  assert.deepEqual(
    serverScheduleBarForNight(
      { ...baseItem, scheduleStripNightKey: '2026-07-21', scheduleBarStartMs: 100, scheduleBarEndMs: 500 },
      '2026-07-21'
    ),
    { startMs: 100, endMs: 500 }
  )
})

test('sessionDurationMsFromItem uses explicit estimate or plans', () => {
  assert.equal(sessionDurationMsFromItem({ estimatedDurationSeconds: 120 }), 120_000)
  assert.ok(sessionDurationMsFromItem({ filterPlans: [{ filterName: 'L', exposureSeconds: 300, count: 1 }] }) >= 60_000)
})

test('listScheduledPendingPlacements sorts by startMs', () => {
  const items: ScheduledStripItem[] = [
    {
      ...baseItem,
      id: 'b',
      plannedStartIso: '2026-07-21T23:00:00.000Z',
      estimatedDurationSeconds: 3600,
    },
    {
      ...baseItem,
      id: 'a',
      plannedStartIso: '2026-07-21T22:00:00.000Z',
      estimatedDurationSeconds: 3600,
    },
  ]
  const start = Date.parse('2026-07-21T20:00:00.000Z')
  const end = Date.parse('2026-07-22T08:00:00.000Z')
  const placements = listScheduledPendingPlacements(items, start, end, '2026-07-21')
  assert.equal(placements.length, 2)
  assert.equal(placements[0]!.item.id, 'a')
  assert.equal(placements[1]!.item.id, 'b')
})

test('placementToTimelineBlock computes percentages', () => {
  const block = placementToTimelineBlock(
    { item: { id: 'x', target: 'Target' }, startMs: 200, endMs: 400 },
    0,
    1000
  )
  assert.equal(block.topPct, 20)
  assert.equal(block.heightPct, 20)
  assert.equal(block.label, 'Target')
})

test('imagingWindowStartMs picks later of window and dusk', () => {
  assert.equal(imagingWindowStartMs(100, 200), 200)
  assert.equal(imagingWindowStartMs(300, 200), 300)
})

test('inProgressSchedulePlacement prefers locked start', () => {
  const item = {
    id: 'ip1',
    status: 'in_progress',
    createdAt: '2026-07-21T22:00:00.000Z',
    estimatedDurationSeconds: 1800,
  }
  const locked = { ip1: { startMs: 1000, endMs: 5000 } }
  const placement = inProgressSchedulePlacement(item, locked, 500, 10_000, 2000)
  assert.equal(placement?.startMs, 1000)
})

test('fallbackPlacementForTerminalSession returns existing lock', () => {
  const item = { id: 'f1', status: 'failed', createdAt: '2026-07-21T22:00:00.000Z' }
  const locked = { f1: { startMs: 100, endMs: 500 } }
  assert.deepEqual(fallbackPlacementForTerminalSession(item, locked, 0, 1000, 200), {
    startMs: 100,
    endMs: 500,
  })
})

test('completedSessionOverlapsTonightStripWindow rejects other nightKey', () => {
  const item = {
    id: 'c1',
    status: 'completed',
    createdAt: '2026-07-21T22:00:00.000Z',
    nightKey: '2026-07-20',
    estimatedDurationSeconds: 3600,
  }
  assert.equal(
    completedSessionOverlapsTonightStripWindow(item, '2026-07-21', 0, 10_000, {}),
    false
  )
})
