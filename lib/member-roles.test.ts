import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canAdministerSite,
  canSubmitImagingAtSite,
  coerceSystemRole,
  formatMemberRoleLabels,
  legacyMemberRoleLabel,
} from '@/lib/member-roles'

test('coerceSystemRole maps legacy admin', () => {
  assert.equal(coerceSystemRole('admin'), 'pomfret_astro_admin')
  assert.equal(coerceSystemRole('member'), 'user')
  assert.equal(coerceSystemRole('user'), 'user')
})

test('legacyMemberRoleLabel treats site admin as admin', () => {
  assert.equal(
    legacyMemberRoleLabel({
      systemRole: 'user',
      memberships: [
        {
          siteId: 'pomfret',
          siteRole: 'observatory_admin',
          imagingApprovedAt: 'x',
          imagingRejectedAt: null,
        },
      ],
    }),
    'admin'
  )
})

test('canAdministerSite is site-scoped for observatory admin', () => {
  const memberships = [
    {
      siteId: 'cygnus',
      siteRole: 'observatory_admin' as const,
      imagingApprovedAt: 'x',
      imagingRejectedAt: null,
    },
  ]
  assert.equal(canAdministerSite({ systemRole: 'user', memberships, siteId: 'cygnus' }), true)
  assert.equal(canAdministerSite({ systemRole: 'user', memberships, siteId: 'pomfret' }), false)
  assert.equal(
    canAdministerSite({ systemRole: 'pomfret_astro_admin', memberships: [], siteId: 'pomfret' }),
    true
  )
})

test('canSubmitImagingAtSite guest closed blocks unaffiliated', () => {
  const decision = canSubmitImagingAtSite({
    systemRole: 'user',
    memberships: [],
    siteId: 'cygnus',
    guestAccessMode: 'closed',
  })
  assert.equal(decision.ok, false)
  if (!decision.ok) assert.equal(decision.code, 'guest_closed')
})

test('canSubmitImagingAtSite open_direct allows guest', () => {
  const decision = canSubmitImagingAtSite({
    systemRole: 'user',
    memberships: [],
    siteId: 'cygnus',
    guestAccessMode: 'open_direct',
  })
  assert.equal(decision.ok, true)
})

test('canSubmitImagingAtSite site_member requires imaging approval', () => {
  const pending = canSubmitImagingAtSite({
    systemRole: 'user',
    memberships: [
      {
        siteId: 'pomfret',
        siteRole: 'observatory_member',
        imagingApprovedAt: null,
        imagingRejectedAt: null,
      },
    ],
    siteId: 'pomfret',
    guestAccessMode: 'closed',
  })
  assert.equal(pending.ok, false)
  if (!pending.ok) assert.equal(pending.code, 'imaging_pending')

  const rejected = canSubmitImagingAtSite({
    systemRole: 'user',
    memberships: [
      {
        siteId: 'pomfret',
        siteRole: 'observatory_member',
        imagingApprovedAt: null,
        imagingRejectedAt: '2020-01-01T00:00:00.000Z',
      },
    ],
    siteId: 'pomfret',
    guestAccessMode: 'closed',
  })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.equal(rejected.code, 'imaging_rejected')

  const approved = canSubmitImagingAtSite({
    systemRole: 'user',
    memberships: [
      {
        siteId: 'pomfret',
        siteRole: 'observatory_member',
        imagingApprovedAt: '2020-01-01T00:00:00.000Z',
        imagingRejectedAt: null,
      },
    ],
    siteId: 'pomfret',
    guestAccessMode: 'closed',
  })
  assert.equal(approved.ok, true)
})

test('formatMemberRoleLabels can include system and site roles', () => {
  assert.deepEqual(
    formatMemberRoleLabels({
      systemRole: 'pomfret_astro_admin',
      memberships: [
        {
          siteId: 'pomfret',
          siteRole: 'observatory_admin',
          imagingApprovedAt: 'x',
          imagingRejectedAt: null,
        },
      ],
    }),
    ['Pomfret Astro Admin']
  )
})
