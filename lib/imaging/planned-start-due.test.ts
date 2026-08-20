import assert from 'node:assert/strict'
import test from 'node:test'
import { plannedStartIsDue } from '@/lib/imaging/planned-start-due'

test('plannedStartIsDue is false before planned start and true at or after', () => {
  const startMs = Date.parse('2026-07-02T04:00:00.000Z')
  assert.equal(plannedStartIsDue('2026-07-02T04:00:00.000Z', startMs - 1), false)
  assert.equal(plannedStartIsDue('2026-07-02T04:00:00.000Z', startMs), true)
  assert.equal(plannedStartIsDue('2026-07-02T04:00:00.000Z', startMs + 60_000), true)
})

test('plannedStartIsDue fails closed on missing or invalid planned start', () => {
  assert.equal(plannedStartIsDue(null, Date.now()), false)
  assert.equal(plannedStartIsDue('', Date.now()), false)
  assert.equal(plannedStartIsDue('not-a-date', Date.now()), false)
})
