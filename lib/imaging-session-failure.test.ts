import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldFailProjectModeBoardEntry } from './imaging-session-failure'

test('shouldFailProjectModeBoardEntry fails non-project sessions', () => {
  assert.equal(shouldFailProjectModeBoardEntry({}, null), true)
  assert.equal(shouldFailProjectModeBoardEntry({ projectMode: false }, null), true)
})

test('shouldFailProjectModeBoardEntry skips parked multi-night project', () => {
  assert.equal(shouldFailProjectModeBoardEntry({ projectMode: true }, null), false)
})

test('shouldFailProjectModeBoardEntry fails multi-night project while a sub-night is imaging', () => {
  assert.equal(
    shouldFailProjectModeBoardEntry({ projectMode: true }, 'proj-1::night-1'),
    true
  )
})
