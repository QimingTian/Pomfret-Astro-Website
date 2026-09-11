import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acknowledgeFailedSubTonightAutoHold,
  clearFailedSubTonightAutoHoldAck,
  ensureFailedSubTonightAutoHoldAckLoaded,
  isFailedSubTonightAutoHoldAcknowledged,
  normalizeFailedSubTonightAutoHoldAck,
  resetFailedSubTonightAutoHoldAckForTests,
  setFailedSubTonightAutoHoldAckMemoryForTests,
} from './failed-sub-auto-hold-ack'

test.beforeEach(() => {
  resetFailedSubTonightAutoHoldAckForTests()
})

test('normalizeFailedSubTonightAutoHoldAck rejects tombstone and empty nightKey', () => {
  assert.equal(normalizeFailedSubTonightAutoHoldAck(null), null)
  assert.equal(normalizeFailedSubTonightAutoHoldAck({ nightKey: '', cleared: true }), null)
  assert.equal(normalizeFailedSubTonightAutoHoldAck({ nightKey: '  ' }), null)
  const ok = normalizeFailedSubTonightAutoHoldAck({
    nightKey: '2026-09-10',
    at: '2026-09-11T03:00:00.000Z',
  })
  assert.deepEqual(ok, { nightKey: '2026-09-10', at: '2026-09-11T03:00:00.000Z' })
})

test('acknowledge sets memory ack for tonight nightKey', async () => {
  await acknowledgeFailedSubTonightAutoHold('2026-09-10')
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-10'), true)
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-11'), false)
})

test('clearFailedSubTonightAutoHoldAck drops memory ack', async () => {
  await acknowledgeFailedSubTonightAutoHold('2026-09-10')
  await clearFailedSubTonightAutoHoldAck()
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-10'), false)
})

test('ensure drops stale memory ack when nightKey is not tonight', async () => {
  setFailedSubTonightAutoHoldAckMemoryForTests('2026-09-09')
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-09'), true)
  await ensureFailedSubTonightAutoHoldAckLoaded('2026-09-10')
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-09'), false)
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-10'), false)
})

test('ensure keeps memory ack that matches tonight when KV disabled', async () => {
  setFailedSubTonightAutoHoldAckMemoryForTests('2026-09-10')
  await ensureFailedSubTonightAutoHoldAckLoaded('2026-09-10')
  assert.equal(isFailedSubTonightAutoHoldAcknowledged('2026-09-10'), true)
})
