import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasDeliverableTonightSubs,
  isPlannedTonight,
} from './imaging-tonight-complete'
import type { ImagingProject } from './imaging-project-store'

const nightKey = '2026-05-17'
const nightStartMs = Date.parse('2026-05-17T22:00:00.000Z')
const deadlineMs = Date.parse('2026-05-18T10:00:00.000Z')

test('isPlannedTonight respects strip window', () => {
  assert.equal(isPlannedTonight('2026-05-17T23:00:00.000Z', nightStartMs, deadlineMs), true)
  assert.equal(isPlannedTonight('2026-05-16T23:00:00.000Z', nightStartMs, deadlineMs), false)
})

test('hasDeliverableTonightSubs ignores scheduled subs without NINA JSON', () => {
  const project: ImagingProject = {
    id: 'p1',
    projectMode: true,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    status: 'in_progress',
    target: 'M101',
    raHours: 12.3,
    decDeg: 21.1,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'L', exposureSeconds: 300, count: 10 }],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 5 }],
    nights: [
      {
        id: 'p1::night-1',
        nightKey,
        nightIndex: 1,
        status: 'completed',
        filterPlansTonight: [{ filterName: 'L', exposureSeconds: 300, count: 5 }],
        ninaSequenceJson: '{}',
      },
      {
        id: 'p1::night-2',
        nightKey,
        nightIndex: 2,
        status: 'scheduled',
        filterPlansTonight: [{ filterName: 'L', exposureSeconds: 300, count: 5 }],
      },
    ],
    onBoard: true,
  }
  assert.equal(hasDeliverableTonightSubs(project, nightKey), false)
})

test('hasDeliverableTonightSubs is true for scheduled sub with JSON', () => {
  const project: ImagingProject = {
    id: 'p2',
    projectMode: true,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    status: 'in_progress',
    target: 'M101',
    raHours: 12.3,
    decDeg: 21.1,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'L', exposureSeconds: 300, count: 10 }],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 5 }],
    nights: [
      {
        id: 'p2::night-2',
        nightKey,
        nightIndex: 2,
        status: 'scheduled',
        filterPlansTonight: [{ filterName: 'L', exposureSeconds: 300, count: 5 }],
        ninaSequenceJson: '{"x":1}',
      },
    ],
    onBoard: true,
  }
  assert.equal(hasDeliverableTonightSubs(project, nightKey), true)
})
