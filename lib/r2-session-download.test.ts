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

test('isAllowedSessionObjectKey accepts nina_agent imaging prefix', () => {
  const id = 'a9a609e6-0e7c-41e7-a1b0-857ae61105d7::night-3'
  assert.equal(
    isAllowedSessionObjectKey(id, `imaging/a9a609e6-0e7c-41e7-a1b0-857ae61105d7__night-3/night-3.zip`),
    true
  )
})

test('isAllowedSessionObjectKey accepts Cygnus imaging_cygnus prefix', () => {
  const id = '55b66d19-3608-436c-aa1e-79eefe8dc536'
  assert.equal(
    isAllowedSessionObjectKey(id, `imaging_cygnus/${id}/${id}.zip`),
    true
  )
  assert.equal(isAllowedSessionObjectKey(id, `imaging_other/${id}/${id}.zip`), false)
})
