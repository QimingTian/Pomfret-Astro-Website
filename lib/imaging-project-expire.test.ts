import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSubSessionWindowEndMs } from './imaging-project-store'
import type { ProjectNight } from './imaging-project-store'

test('projectSubSessionWindowEndMs uses planned start plus duration', () => {
  const night: ProjectNight = {
    id: 'p::night-1',
    nightKey: '2026-05-19',
    nightIndex: 1,
    status: 'in_progress',
    filterPlansTonight: [{ filterName: 'L', exposureSeconds: 60, count: 10 }],
    plannedStartIso: '2026-05-20T05:00:00.000Z',
  }
  const end = projectSubSessionWindowEndMs(night)
  assert.ok(end != null && end > Date.parse(night.plannedStartIso!))
})
