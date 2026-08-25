import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isRedisLiveKey,
  POSTGRES_HOT_BACKUP,
  POSTGRES_LIVE,
  REDIS_LIVE_KEYS,
} from './data-plane'

test('hot imaging docs have Redis live keys the website must not delete', () => {
  assert.equal(REDIS_LIVE_KEYS.queue, 'imaging-queue-requests')
  assert.equal(REDIS_LIVE_KEYS.projects, 'imaging-projects')
  assert.equal(REDIS_LIVE_KEYS.board, 'imaging-session-board')
  assert.equal(isRedisLiveKey('imaging-projects'), true)
  assert.equal(isRedisLiveKey('member-users'), false)
})

test('members and gallery are Postgres-live, not Redis-live', () => {
  assert.ok(POSTGRES_LIVE.includes('users'))
  assert.ok(POSTGRES_LIVE.includes('gallery_submissions'))
  assert.ok(!POSTGRES_LIVE.includes('imaging_requests'))
  assert.ok(POSTGRES_HOT_BACKUP.includes('imaging_projects'))
})
