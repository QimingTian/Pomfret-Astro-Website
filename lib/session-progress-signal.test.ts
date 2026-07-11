import assert from 'node:assert/strict'
import test from 'node:test'
import { isSessionCompletedSignal, readQueueIdFromDetail } from './session-progress-signal'

test('plain text Session Completed is a completion signal', () => {
  assert.equal(isSessionCompletedSignal({ text: 'Session Completed' }), true)
})

test('readQueueIdFromDetail reads PomfretAstro.QueueId', () => {
  const id = readQueueIdFromDetail({
    PomfretAstro: { QueueId: 'proj-1::night-1' },
    text: 'Filter Switched',
  })
  assert.equal(id, 'proj-1::night-1')
})
