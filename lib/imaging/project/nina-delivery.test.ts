import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getDeliverableNight,
  getNightForNinaDelivery,
  getRedeliverableInProgressNight,
  type ImagingProject,
} from '@/lib/imaging-project-store'

const project = {
  id: 'p1',
  status: 'in_progress',
  onBoard: true,
  target: 'M101',
  nights: [
    {
      id: 'p1::night-3',
      nightKey: '2026-06-01',
      nightIndex: 3,
      status: 'in_progress',
      ninaSequenceJson: '{}',
    },
    {
      id: 'p1::night-4',
      nightKey: '2026-06-01',
      nightIndex: 4,
      status: 'scheduled',
      ninaSequenceJson: '{"x":1}',
    },
  ],
} as unknown as ImagingProject

test('getDeliverableNight returns scheduled subs only', () => {
  assert.equal(getDeliverableNight(project, '2026-06-01')?.nightIndex, 4)
})

test('getRedeliverableInProgressNight returns stuck in_progress subs', () => {
  assert.equal(getRedeliverableInProgressNight(project, '2026-06-01')?.nightIndex, 3)
})

test('getNightForNinaDelivery prefers scheduled over redeliverable in_progress', () => {
  assert.equal(getNightForNinaDelivery(project, '2026-06-01')?.nightIndex, 4)
  assert.equal(
    getNightForNinaDelivery(project, '2026-06-01', { allowRedeliverInProgress: true })?.nightIndex,
    4
  )
})

test('getNightForNinaDelivery can redeliver in_progress when no scheduled sub', () => {
  const stuckOnly = {
    ...project,
    nights: [project.nights[0]],
  } as ImagingProject
  assert.equal(getDeliverableNight(stuckOnly, '2026-06-01'), undefined)
  assert.equal(
    getNightForNinaDelivery(stuckOnly, '2026-06-01', { allowRedeliverInProgress: true })?.nightIndex,
    3
  )
})
