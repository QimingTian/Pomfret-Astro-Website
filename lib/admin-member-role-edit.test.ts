import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adminMemberRoleOptions,
  parseAdminMemberRoleKey,
} from '@/lib/admin-member-role-edit'

test('site admin role options never include PA Admin or other sites', () => {
  const options = adminMemberRoleOptions({ isPaAdmin: false, siteId: 'cygnus' })
  assert.deepEqual(
    options.map((o) => o.key),
    ['site:cygnus:observatory_admin', 'site:cygnus:observatory_member']
  )
  assert.equal(
    options.some((o) => o.key === 'pomfret_astro_admin' || o.key.includes('pomfret')),
    false
  )
})

test('PA Admin role options include PA Admin and all sites', () => {
  const keys = adminMemberRoleOptions({ isPaAdmin: true, siteId: 'pomfret' }).map((o) => o.key)
  assert.ok(keys.includes('pomfret_astro_admin'))
  assert.ok(keys.includes('guest'))
  assert.ok(keys.includes('site:cygnus:observatory_admin'))
  assert.ok(keys.includes('site:pomfret:observatory_member'))
})

test('parseAdminMemberRoleKey rejects unknown keys', () => {
  assert.equal(parseAdminMemberRoleKey('site:mars:observatory_admin'), null)
  assert.equal(parseAdminMemberRoleKey('pomfret_astro_admin')?.type, 'pomfret_astro_admin')
})
