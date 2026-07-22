import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSessionFailedTerminalLine,
  queueStatusLabel,
  SESSION_FAILED_TERMINAL_MESSAGE,
} from './queue-status'

test('queueStatusLabel maps known statuses', () => {
  assert.equal(queueStatusLabel('pending'), 'Pending')
  assert.equal(queueStatusLabel('scheduled'), 'Scheduled')
  assert.equal(queueStatusLabel('claimed'), 'In progress')
  assert.equal(queueStatusLabel('unknown_custom'), 'unknown_custom')
})

test('isSessionFailedTerminalLine matches exact terminal message', () => {
  assert.equal(isSessionFailedTerminalLine(SESSION_FAILED_TERMINAL_MESSAGE), true)
  assert.equal(isSessionFailedTerminalLine(`  ${SESSION_FAILED_TERMINAL_MESSAGE}  `), true)
  assert.equal(isSessionFailedTerminalLine('Session failed'), false)
})
