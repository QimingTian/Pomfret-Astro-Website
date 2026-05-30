import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProjectNightSubId } from '../project/ids'

test('parseProjectNightSubId accepts sub-session ids', () => {
  assert.deepEqual(parseProjectNightSubId('abc-uuid::night-2'), {
    projectId: 'abc-uuid',
    nightIndex: 2,
  })
})
