import assert from 'node:assert/strict'
import test from 'node:test'
import { canSubmitImagingFromFlags, canSubmitImagingPublic, memberVerificationStatusLabel } from '@/lib/member-access'
import type { PublicMemberUser } from '@/lib/member-store'

function publicUser(overrides: Partial<PublicMemberUser> = {}): PublicMemberUser {
  return {
    id: 'u1',
    email: 'friend@example.com',
    firstName: 'A',
    lastName: 'B',
    username: 'ab',
    role: 'member',
    systemRole: 'user',
    memberships: [{ siteId: 'pomfret', siteRole: 'observatory_member' }],
    roles: ['Observatory Member · Pomfret School'],
    createdAt: '2026-01-01T00:00:00.000Z',
    emailVerified: false,
    imagingApproved: false,
    imagingPending: false,
    imagingRejected: false,
    pendingMembership: null,
    ...overrides,
  }
}

test('canSubmitImagingFromFlags blocks unverified email', () => {
  const result = canSubmitImagingFromFlags({
    email: 'friend@example.com',
    emailVerified: false,
    imagingApproved: false,
    imagingRejected: false,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /Verify your email/)
})

test('canSubmitImagingFromFlags blocks pending non-pomfret approval', () => {
  const result = canSubmitImagingFromFlags({
    email: 'friend@example.com',
    emailVerified: true,
    imagingApproved: false,
    imagingRejected: false,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /administrator approval/)
})

test('canSubmitImagingFromFlags allows verified and approved', () => {
  const result = canSubmitImagingFromFlags({
    email: 'friend@example.com',
    emailVerified: true,
    imagingApproved: true,
    imagingRejected: false,
  })
  assert.equal(result.ok, true)
})

test('canSubmitImagingPublic mirrors public member flags', () => {
  assert.equal(canSubmitImagingPublic(publicUser({ emailVerified: true, imagingApproved: true })).ok, true)
  assert.equal(
    canSubmitImagingPublic(
      publicUser({
        emailVerified: true,
        imagingApproved: true,
        memberships: [{ siteId: 'pomfret', siteRole: 'observatory_member' }],
      })
    ).ok,
    true
  )
  assert.equal(canSubmitImagingPublic(publicUser({ emailVerified: true, imagingPending: true })).ok, false)
})

test('memberVerificationStatusLabel prioritizes email then imaging', () => {
  assert.equal(
    memberVerificationStatusLabel({ emailVerified: false, imagingApproved: false }),
    'Email Not Verified'
  )
  assert.equal(
    memberVerificationStatusLabel({ emailVerified: true, imagingApproved: false }),
    'Imaging Not Verified'
  )
  assert.equal(
    memberVerificationStatusLabel({ emailVerified: true, imagingApproved: true }),
    'All Verified'
  )
})
