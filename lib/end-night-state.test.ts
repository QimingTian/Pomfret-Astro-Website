import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearEndNightDue,
  isEndNightDue,
  isEndNightSuppressedAfterEstop,
  markEndNightAfterSessionsSent,
  markEndNightDue,
  prepareEndNightAfterEstop,
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

test('prepareEndNightAfterEstop clears due and blocks activity-only end night', async () => {
  const nightKey = `test-estop-suppress-${Date.now()}`
  await markEndNightDue(nightKey)
  await prepareEndNightAfterEstop(nightKey)
  assert.equal(await isEndNightDue(nightKey), false)
  assert.equal(await isEndNightSuppressedAfterEstop(nightKey), true)
  await markEndNightDue(nightKey)
  assert.equal(await isEndNightDue(nightKey), true)
  await clearEndNightDue(nightKey)
})
