import assert from 'node:assert/strict'
import test from 'node:test'
import { plansToScheduledNights, type ProjectTonightPlan } from './planner'
import { getDeliverableNight, type ImagingProject } from './store'

const nightKey = '2026-06-04'
const projectId = 'a9a609e6-0e7c-41e7-a1b0-857ae61105d7'

function baseProject(nights: ImagingProject['nights']): ImagingProject {
  return {
    id: projectId,
    projectMode: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in_progress',
    target: 'M101 Project',
    raHours: 12,
    decDeg: 30,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'R', exposureSeconds: 600, count: 10 }],
    remainingByFilter: [{ filterName: 'R', exposureSeconds: 600, countRemaining: 5 }],
    nights,
    onBoard: true,
  }
}

function samplePlan(): ProjectTonightPlan {
  return {
    nightKey,
    nightIndex: 6,
    filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 2 }],
    plannedStartIso: '2026-06-05T05:50:10.265Z',
    plannedEndIso: '2026-06-05T07:00:10.265Z',
    durationSeconds: 2 * 600 + 30 * 60, // 1 filter, no start/ra → base overhead only
    scheduleReasons: ['test'],
  }
}

test('plansToScheduledNights auto-holds new subs when tonight has a failed sub', () => {
  const project = baseProject([
    {
      id: `${projectId}::night-5`,
      nightKey,
      nightIndex: 5,
      status: 'failed',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 10 }],
      failedAt: '2026-06-05T01:51:15.166Z',
    },
  ])
  const subs = plansToScheduledNights(project, [samplePlan()])
  assert.equal(subs.length, 1)
  const sub = subs[0]!
  assert.equal(sub.status, 'on_hold')
  assert.equal(sub.onHoldFromStatus, 'scheduled')
  assert.equal(sub.plannedStartIso, null)
  assert.equal(sub.scheduleBarStartMs, null)
  assert.equal(sub.ninaSequenceJson != null && sub.ninaSequenceJson.length > 0, true)
})

test('plansToScheduledNights stays scheduled when no failed sub tonight', () => {
  const project = baseProject([
    {
      id: `${projectId}::night-5`,
      nightKey,
      nightIndex: 5,
      status: 'in_progress',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 10 }],
      ninaSequenceJson: '{}',
    },
  ])
  const subs = plansToScheduledNights(project, [samplePlan()])
  assert.equal(subs[0]!.status, 'scheduled')
  assert.equal(subs[0]!.plannedStartIso, samplePlan().plannedStartIso)
})

test('plansToScheduledNights keeps scheduled when reusing active admin force-run sub', () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString()
  const project = baseProject([
    {
      id: `${projectId}::night-5`,
      nightKey,
      nightIndex: 5,
      status: 'failed',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 10 }],
    },
    {
      id: `${projectId}::night-6`,
      nightKey,
      nightIndex: 6,
      status: 'scheduled',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 2 }],
      plannedStartIso: '2026-06-05T05:50:10.265Z',
      adminForceRunUntilIso: future,
      ninaSequenceJson: '{}',
    },
  ])
  const subs = plansToScheduledNights(project, [samplePlan()])
  assert.equal(subs[0]!.status, 'scheduled')
  assert.equal(subs[0]!.id, `${projectId}::night-6`)
})

test('getDeliverableNight ignores on_hold subs', () => {
  const project = baseProject([
    {
      id: `${projectId}::night-5`,
      nightKey,
      nightIndex: 5,
      status: 'failed',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 10 }],
    },
    {
      id: `${projectId}::night-6`,
      nightKey,
      nightIndex: 6,
      status: 'on_hold',
      onHoldFromStatus: 'scheduled',
      filterPlansTonight: [{ filterName: 'R', exposureSeconds: 600, count: 2 }],
      ninaSequenceJson: '{"x":1}',
    },
  ])
  assert.equal(getDeliverableNight(project, nightKey), undefined)
})
