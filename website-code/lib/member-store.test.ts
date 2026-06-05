import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMemberEmail, normalizeMemberUsername } from './member-store'

test('normalizeMemberEmail lowercases and trims', () => {
  assert.equal(normalizeMemberEmail('  QTian.28@Pomfret.org '), 'qtian.28@pomfret.org')
})

test('normalizeMemberUsername lowercases and trims', () => {
  assert.equal(normalizeMemberUsername('  James.Tian '), 'james.tian')
})
