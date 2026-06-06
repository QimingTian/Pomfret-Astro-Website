import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeLegacyAuditStatus,
  projectNightStatusToAuditStatus,
  queueStatusToAuditStatus,
} from '@/lib/imaging/session/status-audit'

test('normalizeLegacyAuditStatus maps unscheduled to pending', () => {
  assert.equal(normalizeLegacyAuditStatus('unscheduled'), 'pending')
  assert.equal(normalizeLegacyAuditStatus('scheduled'), 'scheduled')
  assert.equal(normalizeLegacyAuditStatus('bogus'), null)
})

test('queueStatusToAuditStatus passes through queue lifecycle statuses', () => {
  assert.equal(queueStatusToAuditStatus('pending'), 'pending')
  assert.equal(queueStatusToAuditStatus('in_progress'), 'in_progress')
})

test('projectNightStatusToAuditStatus maps planned to pending', () => {
  assert.equal(projectNightStatusToAuditStatus('planned'), 'pending')
  assert.equal(projectNightStatusToAuditStatus('scheduled'), 'scheduled')
})
