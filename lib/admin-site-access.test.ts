import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adminAccessibleSiteIds,
  adminMembersDirectoryScope,
  filterMembersForAdminSite,
  siteHasAllSkyCamera,
} from '@/lib/admin-site-access'

test('PA Admin can access all observatory sites', () => {
  assert.deepEqual(
    adminAccessibleSiteIds({ systemRole: 'pomfret_astro_admin', memberships: [] }),
    ['pomfret', 'cygnus']
  )
})

test('site admin only accesses administered sites', () => {
  assert.deepEqual(
    adminAccessibleSiteIds({
      systemRole: 'user',
      memberships: [
        {
          siteId: 'cygnus',
          siteRole: 'observatory_admin',
        },
      ],
    }),
    ['cygnus']
  )
})

test('PA Admin members directory is global', () => {
  assert.equal(
    adminMembersDirectoryScope({ systemRole: 'pomfret_astro_admin', memberships: [] }),
    'all'
  )
})

test('site admin members directory is scoped to their site', () => {
  assert.equal(
    adminMembersDirectoryScope({
      systemRole: 'user',
      memberships: [
        {
          siteId: 'cygnus',
          siteRole: 'observatory_admin',
        },
      ],
    }),
    'cygnus'
  )
})

test('filterMembersForAdminSite keeps affiliated members only', () => {
  const members = [
    {
      id: '1',
      email: 'a@x.com',
      memberships: [{ siteId: 'pomfret', siteRole: 'member' as const }],
    },
    {
      id: '2',
      email: 'b@x.com',
      memberships: [{ siteId: 'cygnus', siteRole: 'member' as const }],
    },
  ]
  assert.deepEqual(
    filterMembersForAdminSite(members as never, 'cygnus').map((m) => m.id),
    ['2']
  )
})

test('siteHasAllSkyCamera is Pomfret-only', () => {
  assert.equal(siteHasAllSkyCamera('pomfret'), true)
  assert.equal(siteHasAllSkyCamera('cygnus'), false)
})
