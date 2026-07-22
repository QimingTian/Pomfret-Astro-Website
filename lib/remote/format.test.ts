import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDurationShort } from './format'

test('formatDurationShort returns -- for invalid input', () => {
  assert.equal(formatDurationShort(undefined), '--')
  assert.equal(formatDurationShort(0), '--')
  assert.equal(formatDurationShort(Number.NaN), '--')
})

test('formatDurationShort formats minutes-only and hours', () => {
  assert.equal(formatDurationShort(45 * 60), '45m')
  assert.equal(formatDurationShort(2 * 3600 + 15 * 60), '2h 15m')
})
