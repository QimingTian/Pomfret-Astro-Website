import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emitLiveEvent,
  liveProgressChannel,
  subscribeLiveEvents,
} from './live-bus'

test('emitLiveEvent notifies local subscribers without KV', async () => {
  const channel = liveProgressChannel('test-queue-local')
  const seen: unknown[] = []
  const unsub = subscribeLiveEvents(channel, (payload) => {
    seen.push(payload)
  })

  await emitLiveEvent(channel, { type: 'line', at: '2026-01-01T00:00:00.000Z', text: 'hello' })
  unsub()

  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], {
    type: 'line',
    at: '2026-01-01T00:00:00.000Z',
    text: 'hello',
  })
})

test('subscribeLiveEvent unsubscribe stops local delivery', async () => {
  const channel = liveProgressChannel('test-queue-unsub')
  const seen: unknown[] = []
  const unsub = subscribeLiveEvents(channel, (payload) => {
    seen.push(payload)
  })
  unsub()

  await emitLiveEvent(channel, { type: 'status', queueStatus: 'in_progress' })

  assert.equal(seen.length, 0)
})
