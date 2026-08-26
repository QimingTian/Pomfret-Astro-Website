import assert from 'node:assert/strict'
import test from 'node:test'
import { auditRoutedQueueId } from '../../session-progress-signal'
import { trimAuditEntries, type AuditLogEntry } from './audit-log'

test('auditRoutedQueueId prefers server queueId over NINA QueueId', () => {
  const id = auditRoutedQueueId({
    QueueId: 'proj-1',
    PomfretAstro: { QueueId: 'proj-1' },
    queueId: 'proj-1::night-2',
  })
  assert.equal(id, 'proj-1::night-2')
})

test('trimAuditEntries prefers non-progress over Image spam', () => {
  const entries: AuditLogEntry[] = []
  for (let i = 0; i < 500; i++) {
    entries.push({
      id: `p${i}`,
      at: `2026-08-26T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
      kind: 'session.progress',
      message: `Image ${i}`,
    })
  }
  for (let i = 0; i < 50; i++) {
    entries.push({
      id: `e${i}`,
      at: `2026-08-20T${String(i).padStart(2, '0')}:00:00.000Z`,
      kind: 'emergency_stop',
      message: `ESTOP ${i}`,
    })
  }
  const trimmed = trimAuditEntries(entries, 400)
  assert.equal(trimmed.length, 400)
  const other = trimmed.filter((e) => e.kind !== 'session.progress')
  assert.equal(other.length, 50)
  assert.equal(trimmed.filter((e) => e.kind === 'session.progress').length, 350)
})

test('trimAuditEntries reserves progress slots when non-progress exceeds max', () => {
  const entries: AuditLogEntry[] = []
  for (let i = 0; i < 500; i++) {
    entries.push({
      id: `o${i}`,
      at: `2026-08-20T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
      kind: 'queue.status',
      message: `evt ${i}`,
    })
  }
  for (let i = 0; i < 200; i++) {
    entries.push({
      id: `p${i}`,
      at: `2026-08-26T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
      kind: 'session.progress',
      message: `Image ${i}`,
    })
  }
  const trimmed = trimAuditEntries(entries, 400)
  assert.equal(trimmed.length, 400)
  assert.equal(trimmed.filter((e) => e.kind === 'session.progress').length, 80)
  assert.equal(trimmed.filter((e) => e.kind !== 'session.progress').length, 320)
})
