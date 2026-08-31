import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS,
  guestAccessModeFromSettings,
  normalizeProjectDurationLimitHours,
  projectDurationLimitSeconds,
  settingsFromPolicy,
} from '@/lib/site-access-control'
import {
  projectTotalDurationNeedsAdminApproval,
} from '@/lib/imaging/large-project-approval'

test('guestAccessModeFromSettings maps UI toggles to policy modes', () => {
  assert.equal(
    guestAccessModeFromSettings({ openToGuest: false, guestSessionRequiresApproval: false }),
    'closed'
  )
  assert.equal(
    guestAccessModeFromSettings({ openToGuest: true, guestSessionRequiresApproval: false }),
    'open_direct'
  )
  assert.equal(
    guestAccessModeFromSettings({ openToGuest: true, guestSessionRequiresApproval: true }),
    'open_approval'
  )
})

test('settingsFromPolicy round-trips guest modes', () => {
  assert.deepEqual(settingsFromPolicy('open_approval', 24), {
    openToGuest: true,
    guestSessionRequiresApproval: true,
    memberProjectDurationLimitHours: 24,
  })
})

test('projectTotalDurationNeedsAdminApproval respects custom site limit', () => {
  const limit = projectDurationLimitSeconds(24)
  assert.equal(projectTotalDurationNeedsAdminApproval(limit, limit), false)
  assert.equal(projectTotalDurationNeedsAdminApproval(limit + 1, limit), true)
})

test('normalizeProjectDurationLimitHours falls back to default', () => {
  assert.equal(normalizeProjectDurationLimitHours(-1), DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS)
})

test('projectDurationLimitSeconds treats zero as no limit', () => {
  assert.equal(projectDurationLimitSeconds(0), 0)
})
