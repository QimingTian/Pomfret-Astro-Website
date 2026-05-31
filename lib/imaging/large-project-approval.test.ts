import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LARGE_PROJECT_ADMIN_APPROVAL_SECONDS,
  formatImagingDurationHours,
  projectTotalDurationNeedsAdminApproval,
} from './large-project-approval'

test('projectTotalDurationNeedsAdminApproval is false at exactly 30 hours', () => {
  assert.equal(projectTotalDurationNeedsAdminApproval(LARGE_PROJECT_ADMIN_APPROVAL_SECONDS), false)
})

test('projectTotalDurationNeedsAdminApproval is true above 30 hours', () => {
  assert.equal(projectTotalDurationNeedsAdminApproval(LARGE_PROJECT_ADMIN_APPROVAL_SECONDS + 1), true)
})

test('formatImagingDurationHours renders one decimal hour', () => {
  assert.equal(formatImagingDurationHours(30.5 * 3600), '30.5 h')
})
