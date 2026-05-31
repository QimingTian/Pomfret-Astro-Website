import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveQueueScheduleState } from '@/lib/imaging/queue/schedule-audit'
import type { ImagingProject } from '@/lib/imaging-project-store'
import type { ImagingRequest } from '@/lib/imaging-queue-store'

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
