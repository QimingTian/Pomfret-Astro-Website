import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAltitudeHoldIntervals } from './imaging-project-altitude-hold'
import { plannerFreeIntervalsBehindInProgressProject } from './imaging-project-planner'
import type { ImagingProject } from './imaging-project-store'
import { getTonightSchedulingWindow } from './sunrise-window'

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
