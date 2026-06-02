import assert from 'node:assert/strict'
import test from 'node:test'
import { effectiveProjectStatus, type ImagingProject } from '@/lib/imaging-project-store'

function baseProject(overrides: Partial<ImagingProject> = {}): ImagingProject {
  return {
    id: 'proj-1',
    projectMode: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    status: 'pending',
    target: 'M101 Project',
    raHours: 12,
    decDeg: 30,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'H', exposureSeconds: 600, count: 10 }],
    remainingByFilter: [{ filterName: 'H', exposureSeconds: 600, countRemaining: 10 }],
    nights: [],
    estimatedDurationSeconds: 6000,
    onBoard: false,
    ...overrides,
  }
}

test('effectiveProjectStatus returns in_progress when any night is in_progress', () => {
  const p = baseProject({
    status: 'pending',
    nights: [
      {
        id: 'proj-1::night-3',
        nightIndex: 3,
        nightKey: '2026-06-01',
        status: 'in_progress',
        plannedStartIso: '2026-06-02T01:00:00.000Z',
        filterPlansTonight: [{ filterName: 'H', exposureSeconds: 600, count: 5 }],
        ninaSequenceJson: '{}',
      },
    ],
  })
  assert.equal(effectiveProjectStatus(p), 'in_progress')
})

test('effectiveProjectStatus returns scheduled when subs are scheduled but parent is pending', () => {
  const p = baseProject({
    status: 'pending',
    nights: [
      {
        id: 'proj-1::night-1',
        nightIndex: 1,
        nightKey: '2026-06-01',
        status: 'scheduled',
        plannedStartIso: '2026-06-02T01:00:00.000Z',
        filterPlansTonight: [{ filterName: 'H', exposureSeconds: 600, count: 5 }],
        ninaSequenceJson: '{}',
      },
    ],
  })
  assert.equal(effectiveProjectStatus(p), 'scheduled')
})
