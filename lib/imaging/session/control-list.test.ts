import assert from 'node:assert/strict'
import test from 'node:test'
import { isProjectVisibleToOperators, type ImagingProject } from '@/lib/imaging-project-store'

test('in_progress project without queue row is visible to operators', async () => {
  const project: ImagingProject = {
    id: 'a9a609e6-0e7c-41e7-a1b0-857ae61105d7',
    target: 'M101 Project',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    status: 'in_progress',
    onBoard: false,
    raHours: 12,
    decDeg: 30,
    outputMode: 'raw_zip',
    estimatedDurationSeconds: 1000,
    filterPlansTotal: [{ filterName: 'H', exposureSeconds: 600, count: 100 }],
    remainingByFilter: [{ filterName: 'H', countRemaining: 50 }],
    nights: [
      {
        id: 'a9a609e6-0e7c-41e7-a1b0-857ae61105d7::night-3',
        nightIndex: 3,
        nightKey: '2026-06-01',
        status: 'scheduled',
        plannedStartIso: '2026-06-02T01:31:15.515Z',
        filterPlansTonight: [{ filterName: 'H', exposureSeconds: 600, count: 26 }],
        ninaSequenceJson: '{}',
      },
    ],
  }
  assert.equal(await isProjectVisibleToOperators(project), true)
})
