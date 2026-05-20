import assert from 'node:assert/strict'
import test from 'node:test'
import { auditRoutedQueueId } from './session-progress-signal'

test('auditRoutedQueueId prefers server queueId over NINA QueueId', () => {
  const id = auditRoutedQueueId({
    QueueId: 'proj-1',
    PomfretAstro: { QueueId: 'proj-1' },
    queueId: 'proj-1::night-2',
  })
  assert.equal(id, 'proj-1::night-2')
})
