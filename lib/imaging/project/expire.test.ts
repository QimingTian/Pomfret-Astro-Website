import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSubSessionWindowEndMs } from './store'
import type { ProjectNight } from './store'

test('projectSubSessionWindowEndMs uses planned start plus dynamic overhead', () => {
  const night: ProjectNight = {
    id: 'p::night-1',
    nightKey: '2026-05-19',
    nightIndex: 1,
    status: 'in_progress',
    filterPlansTonight: [{ filterName: 'L', exposureSeconds: 60, count: 10 }],
    plannedStartIso: '2026-05-20T05:00:00.000Z',
  }
  const start = Date.parse(night.plannedStartIso!)
  // No raHours → base 30 min only (no meridian flip).
  const end = projectSubSessionWindowEndMs(night)
  assert.equal(end, start + (10 * 60 + 30 * 60) * 1000)
})
