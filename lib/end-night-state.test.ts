import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearEndNightDue,
  isEndNightDue,
  markEndNightAfterSessionsSent,
  markEndNightDue,
  wasEndNightAfterSessionsSent,
} from './end-night-state'

test('markEndNightDue re-arms after-sessions close after a previous send', async () => {
  const nightKey = `test-end-night-${Date.now()}`
  await markEndNightAfterSessionsSent(nightKey)
  assert.equal(await wasEndNightAfterSessionsSent(nightKey), true)
  assert.equal(await isEndNightDue(nightKey), false)

  await markEndNightDue(nightKey)
  assert.equal(await isEndNightDue(nightKey), true)
  assert.equal(await wasEndNightAfterSessionsSent(nightKey), false)

  await clearEndNightDue(nightKey)
})
