import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedSessionObjectKey } from './r2-session-download'

test('isAllowedSessionObjectKey accepts session prefix', () => {
  const id = 'abc-123'
  assert.equal(isAllowedSessionObjectKey(id, `sessions/${id}/data.zip`), true)
})

test('isAllowedSessionObjectKey rejects gallery keys', () => {
  assert.equal(isAllowedSessionObjectKey('x', 'gallery-submissions/pending/foo.jpg'), false)
})

test('isAllowedSessionObjectKey rejects path traversal', () => {
  assert.equal(isAllowedSessionObjectKey('x', '../gallery-submissions/secret'), false)
})
