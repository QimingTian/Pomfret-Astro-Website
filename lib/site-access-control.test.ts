import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emailMatchesAutoJoinSuffixes,
  guestAccessModeFromSettings,
  isAllowedOtherObservatoryMember,
  normalizeEmailSuffixes,
  normalizeSiteAccessControlSettings,
  sessionNeedsAdminApproval,
  defaultSessionGatePolicy,
} from '@/lib/site-access-control'

test('normalizeSiteAccessControlSettings accepts full shape', () => {
  const s = normalizeSiteAccessControlSettings({
    openToGuest: true,
    guestSessionPolicy: { mode: 'duration_limit', durationLimitHours: 4 },
    openToOtherObservatoryMembers: true,
    otherObservatoryMemberScope: ['pomfret'],
    otherMemberSessionPolicy: { mode: 'always_approve', durationLimitHours: 8 },
    memberProjectDurationLimitHours: 20,
  })
  assert.equal(s.openToGuest, true)
  assert.equal(s.guestSessionPolicy.mode, 'duration_limit')
  assert.equal(s.guestSessionPolicy.durationLimitHours, 4)
  assert.deepEqual(s.otherObservatoryMemberScope, ['pomfret'])
  assert.equal(s.otherMemberSessionPolicy.mode, 'always_approve')
})

test('legacy guestSessionRequiresApproval still maps', () => {
  const s = normalizeSiteAccessControlSettings({
    openToGuest: true,
    guestSessionRequiresApproval: true,
    memberProjectDurationLimitHours: 30,
  })
  assert.equal(s.guestSessionPolicy.mode, 'always_approve')
})

test('guestAccessModeFromSettings is closed or open_direct', () => {
  assert.equal(guestAccessModeFromSettings({ openToGuest: false }), 'closed')
  assert.equal(guestAccessModeFromSettings({ openToGuest: true }), 'open_direct')
})

test('sessionNeedsAdminApproval modes', () => {
  assert.equal(sessionNeedsAdminApproval(defaultSessionGatePolicy('direct'), 99999), false)
  assert.equal(sessionNeedsAdminApproval(defaultSessionGatePolicy('always_approve'), 1), true)
  assert.equal(
    sessionNeedsAdminApproval({ mode: 'duration_limit', durationLimitHours: 2 }, 2 * 3600),
    false
  )
  assert.equal(
    sessionNeedsAdminApproval({ mode: 'duration_limit', durationLimitHours: 2 }, 2 * 3600 + 1),
    true
  )
})

test('normalizeEmailSuffixes and emailMatchesAutoJoinSuffixes', () => {
  assert.deepEqual(normalizeEmailSuffixes('@pomfret.org, cygnus.edu'), [
    '@pomfret.org',
    '@cygnus.edu',
  ])
  assert.equal(emailMatchesAutoJoinSuffixes('a@pomfret.org', ['@pomfret.org']), true)
  assert.equal(emailMatchesAutoJoinSuffixes('a@elsewhere.org', ['@pomfret.org']), false)
})

test('normalizeSiteAccessControlSettings keeps email suffixes', () => {
  const s = normalizeSiteAccessControlSettings({
    memberEmailAutoJoinSuffixes: ['pomfret.org', '@POMFRET.ORG'],
  })
  assert.deepEqual(s.memberEmailAutoJoinSuffixes, ['@pomfret.org'])
})

test('isAllowedOtherObservatoryMember respects scope', () => {
  assert.equal(
    isAllowedOtherObservatoryMember({
      memberships: [{ siteId: 'pomfret' }],
      currentSiteId: 'cygnus',
      scope: 'all',
    }),
    true
  )
  assert.equal(
    isAllowedOtherObservatoryMember({
      memberships: [{ siteId: 'pomfret' }],
      currentSiteId: 'cygnus',
      scope: ['pomfret'],
    }),
    true
  )
  assert.equal(
    isAllowedOtherObservatoryMember({
      memberships: [{ siteId: 'pomfret' }],
      currentSiteId: 'cygnus',
      scope: [],
    }),
    false
  )
})
