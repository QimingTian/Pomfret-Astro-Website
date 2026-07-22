import assert from 'node:assert/strict'
import test from 'node:test'
import { queueStatusBadgeClass, statusLabel } from './ui-status'

test('queueStatusBadgeClass maps known statuses to Tailwind classes', () => {
  assert.match(queueStatusBadgeClass('pending'), /amber/)
  assert.match(queueStatusBadgeClass('scheduled'), /cyan/)
  assert.match(queueStatusBadgeClass('failed'), /red/)
  assert.equal(queueStatusBadgeClass('unknown'), 'text-gray-500 dark:text-gray-500')
})

test('statusLabel maps observatory statuses', () => {
  assert.equal(statusLabel('ready'), 'Ready')
  assert.equal(statusLabel('busy_in_use'), 'Busy -- In Use')
  assert.equal(statusLabel('closed_daytime'), 'Closed -- Daytime')
  assert.equal(statusLabel('closed_observatory_maintenance'), 'Closed -- Observatory Maintenance')
})
