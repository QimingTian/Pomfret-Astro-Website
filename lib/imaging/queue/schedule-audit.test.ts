import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveQueueScheduleState } from '@/lib/imaging/queue/schedule-audit'
import {
  plannedStartsBothDue,
  plannedStartsEquivalent,
} from '@/lib/imaging/planned-start-stability'
import type { ImagingProject } from '@/lib/imaging-project-store'
import type { ImagingRequest } from '@/lib/imaging-queue-store'

test('sub-minute planned-start drift is not an imaging-plan change', () => {
  const base = '2026-05-31T01:00:00.000Z'
  const drifted = '2026-05-31T01:00:47.000Z'
  const moved = '2026-05-31T01:05:00.000Z'

  assert.equal(plannedStartsEquivalent(base, base), true)
  assert.equal(plannedStartsEquivalent(base, drifted), true, 'a 47-second re-derivation is noise')
  assert.equal(plannedStartsEquivalent(base, moved), false, 'a 5-minute move is a real change')
})

test('a due row whose start tracks the clock is not an imaging-plan change', () => {
  const nowMs = Date.parse('2026-05-31T02:00:00.000Z')
  const dueEarlier = '2026-05-31T01:45:00.000Z'
  const dueNow = new Date(nowMs).toISOString()
  const laterTonight = '2026-05-31T04:00:00.000Z'

  assert.equal(
    plannedStartsBothDue(dueEarlier, dueNow, nowMs),
    true,
    'both starts are overdue, so only the clock moved'
  )
  assert.equal(
    plannedStartsBothDue(dueEarlier, laterTonight, nowMs),
    false,
    'moving a due row behind a reservation is a real change'
  )
  assert.equal(plannedStartsBothDue(dueEarlier, null, nowMs), false)
})

test('planned-start equivalence treats unset starts as a state of their own', () => {
  assert.equal(plannedStartsEquivalent(null, null), true)
  assert.equal(plannedStartsEquivalent(null, undefined), true)
  assert.equal(plannedStartsEquivalent(null, '2026-05-31T01:00:00.000Z'), false)
  assert.equal(plannedStartsEquivalent('2026-05-31T01:00:00.000Z', 'not-a-date'), false)
})

test('deriveQueueScheduleState treats in_progress queue with scheduled sub tonight as scheduled', () => {
  const row: Pick<ImagingRequest, 'status' | 'plannedStartIso' | 'projectMode'> = {
    status: 'in_progress',
    plannedStartIso: null,
    projectMode: true,
  }
  const project: Pick<ImagingProject, 'nights'> = {
    nights: [
      {
        id: 'p::night-3',
        nightIndex: 3,
        nightKey: '2026-05-30',
        status: 'scheduled',
        plannedStartIso: '2026-05-31T01:00:00.000Z',
        filterPlansTonight: [{ filterName: 'Red', exposureSeconds: 300, count: 4 }],
        ninaSequenceJson: '{}',
      },
    ],
  }
  assert.equal(deriveQueueScheduleState(row, project, '2026-05-30'), 'scheduled')
  assert.equal(deriveQueueScheduleState(row, project, '2026-05-29'), 'unscheduled')
})

test('deriveQueueScheduleState uses queue scheduled status for single-night sessions', () => {
  const row: Pick<ImagingRequest, 'status' | 'plannedStartIso' | 'projectMode'> = {
    status: 'scheduled',
    plannedStartIso: '2026-05-31T01:00:00.000Z',
    projectMode: false,
  }
  assert.equal(deriveQueueScheduleState(row, null, '2026-05-30'), 'scheduled')
})

test('deriveQueueScheduleState uses project nights when queue row is missing (in_progress project)', () => {
  const project: Pick<ImagingProject, 'nights'> = {
    nights: [
      {
        id: 'p::night-3',
        nightIndex: 3,
        nightKey: '2026-06-01',
        status: 'scheduled',
        plannedStartIso: '2026-06-02T01:31:15.515Z',
        filterPlansTonight: [{ filterName: 'H', exposureSeconds: 600, count: 26 }],
        ninaSequenceJson: '{}',
      },
    ],
  }
  assert.equal(deriveQueueScheduleState(null, project, '2026-06-01'), 'scheduled')
  assert.equal(deriveQueueScheduleState(undefined, project, '2026-05-30'), 'unscheduled')
})
