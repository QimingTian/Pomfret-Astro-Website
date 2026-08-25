import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAltitudeHoldIntervals, remainingFiltersMoonBlockedTonight } from './altitude-hold'
import { plannerFreeIntervalsBehindInProgressProject } from './planner'
import type { ImagingProject } from './store'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

test('plannerFreeIntervalsBehindInProgressProject removes active target >=30° windows', () => {
  const now = new Date('2026-05-17T22:00:00.000Z')
  const window = getTonightSchedulingWindow(now)
  const free = [
    {
      startMs: window.nauticalDuskUtc.getTime(),
      endMs: window.nauticalDawnUtc.getTime(),
    },
  ]
  const active: ImagingProject = {
    id: 'proj-a',
    projectMode: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'in_progress',
    target: 'High Early',
    raHours: 12.7,
    decDeg: 12,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'L', exposureSeconds: 300, count: 10 }],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
    nights: [],
    onBoard: true,
  }
  const hold = projectAltitudeHoldIntervals(active, now)
  const successorFree = plannerFreeIntervalsBehindInProgressProject(active, free, '2026-05-17', now)
  const holdMs = hold.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  const freeMs = free.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  const successorMs = successorFree.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  assert.ok(holdMs > 0, 'active target should have some >=30° time tonight')
  assert.ok(successorMs < freeMs, 'successor free time should be smaller than full night')
  assert.ok(successorMs <= freeMs - holdMs + 60_000, 'successor free should roughly exclude hold windows')
})

test('altitude hold stays when a remaining filter can still clear moon tonight', () => {
  const now = new Date('2026-05-31T20:00:00.000Z')
  const project = {
    raHours: 17.23,
    decDeg: 50,
    remainingByFilter: [{ filterName: 'H', exposureSeconds: 300, countRemaining: 10 }],
  }
  assert.equal(remainingFiltersMoonBlockedTonight(project, now), false)
  assert.ok(projectAltitudeHoldIntervals(project, now).length > 0)
})

test('altitude hold is released when every remaining filter is moon-blocked for the rest of tonight', () => {
  const now = new Date('2026-06-01T04:00:00.000Z')
  const project = {
    raHours: 17.23,
    decDeg: 50,
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
  }
  assert.equal(remainingFiltersMoonBlockedTonight(project, now), true)
  assert.deepEqual(projectAltitudeHoldIntervals(project, now), [])
})
