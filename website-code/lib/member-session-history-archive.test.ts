import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEMBER_SESSION_HISTORY_RETENTION_MS,
  recordMemberSessionHistory,
  syncMemberSessionHistoryArchive,
} from './member-session-history-archive'
import type { MemberSessionHistoryRow } from './member-session-history'

function row(id: string, updatedAt: string): MemberSessionHistoryRow {
  return {
    id,
    kind: 'queue',
    target: 'Target',
    status: 'completed',
    displayStatus: 'completed',
    createdAt: updatedAt,
    updatedAt,
    projectMode: false,
  }
}

test('archive drops entries older than retention on sync', async () => {
  const userId = 'user-archive-test'
  const old = new Date(Date.now() - MEMBER_SESSION_HISTORY_RETENTION_MS - 86400000).toISOString()
  const recent = new Date().toISOString()
  await recordMemberSessionHistory(userId, row('old', old))
  await recordMemberSessionHistory(userId, row('recent', recent))
  const merged = await syncMemberSessionHistoryArchive(userId, [])
  assert.equal(
    merged.some((s) => s.id === 'recent'),
    true
  )
  assert.equal(
    merged.some((s) => s.id === 'old'),
    false
  )
})

test('archive keeps rows after live purge', async () => {
  const userId = 'user-archive-orphan'
  const ts = new Date().toISOString()
  await recordMemberSessionHistory(userId, row('gone', ts))
  const merged = await syncMemberSessionHistoryArchive(userId, [])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.id, 'gone')
})
