import assert from 'node:assert/strict'
import test from 'node:test'
import { DSO_SESSION_OVERHEAD_SEC } from '@/lib/imaging-session-overhead'
import { estimateDurationSecondsFromPlans } from './duration'

test('estimateDurationSecondsFromPlans returns overhead when plans missing', () => {
  assert.equal(estimateDurationSecondsFromPlans(undefined), DSO_SESSION_OVERHEAD_SEC)
  assert.equal(estimateDurationSecondsFromPlans([]), DSO_SESSION_OVERHEAD_SEC)
})

test('estimateDurationSecondsFromPlans is at least overhead for real plans', () => {
  const sec = estimateDurationSecondsFromPlans([
    { filterName: 'L', exposureSeconds: 300, count: 10 },
  ])
  assert.ok(sec >= DSO_SESSION_OVERHEAD_SEC)
})
