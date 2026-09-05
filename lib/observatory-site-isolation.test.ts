import assert from 'node:assert/strict'
import test from 'node:test'
import { CYGNUS_SITE, POMFRET_SITE } from '@/lib/observatory-sites'
import {
  markEndNightDawnSent,
  markEndNightDue,
  wasEndNightDawnSent,
  isEndNightDue,
} from '@/lib/end-night-state'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

test('end-night flags do not cross sites for the same calendar nightKey', async () => {
  const nightKey = '2099-01-15'
  await withObservatorySiteAsync(POMFRET_SITE.id, async () => {
    await markEndNightDawnSent(nightKey)
    await markEndNightDue(nightKey)
    assert.equal(await wasEndNightDawnSent(nightKey), true)
    assert.equal(await isEndNightDue(nightKey), true)
  })
  await withObservatorySiteAsync(CYGNUS_SITE.id, async () => {
    assert.equal(await wasEndNightDawnSent(nightKey), false)
    assert.equal(await isEndNightDue(nightKey), false)
  })
})
