import assert from 'node:assert/strict'
import test from 'node:test'

import { formatMemberRoleLabels } from '@/lib/member-roles'
import { hydrateMemberUserRecord } from '@/lib/member-store'

const baseRecord = {
  id: 'guest-1',
  email: 'preview.guest@example.com',
  passwordHash: 'hash',
  firstName: 'Preview',
  lastName: 'Guest',
  username: 'previewguest',
  systemRole: 'user',
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  emailVerifiedAt: null,
  imagingApprovedAt: null,
  imagingRejectedAt: null,
}

test('hydrate preserves intentional Guest (memberships: [])', () => {
  const user = hydrateMemberUserRecord({ ...baseRecord, memberships: [] })
  assert.ok(user)
  assert.equal(user!.memberships.length, 0)
  assert.deepEqual(formatMemberRoleLabels(user!), ['Guest'])
})

test('hydrate still upgrades legacy KV records without memberships array', () => {
  const user = hydrateMemberUserRecord({ ...baseRecord })
  assert.ok(user)
  assert.equal(user!.memberships.length, 1)
  assert.equal(user!.memberships[0]!.siteId, 'pomfret')
  assert.equal(user!.memberships[0]!.siteRole, 'observatory_member')
})

test('hydrate preserves site role changes from Postgres rows', () => {
  const user = hydrateMemberUserRecord({
    ...baseRecord,
    role: 'admin',
    memberships: [
      {
        siteId: 'pomfret',
        siteRole: 'observatory_admin',
        imagingApprovedAt: null,
        imagingRejectedAt: null,
      },
    ],
  })
  assert.ok(user)
  assert.equal(user!.memberships[0]!.siteRole, 'observatory_admin')
  assert.deepEqual(formatMemberRoleLabels(user!), ['Observatory Admin · Pomfret School'])
})
