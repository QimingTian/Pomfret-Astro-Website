import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isEndNightDue,
  markEndNightDawnSent,
  markEndNightDue,
  wasEndNightDawnSent,
} from './end-night-state'
import { withObservatorySiteAsync } from './observatory-site-scope'

/**
 * Amsterdam and Pomfret share most calendar night keys. These flags decide whether
 * a dome still gets its closing sequence, so they must never be shared.
 */
test('end-night dawn flag does not cross observatories', async () => {
  const nightKey = '2026-09-04'

  await withObservatorySiteAsync('pomfret', async () => {
    await markEndNightDawnSent(nightKey)
    assert.equal(await wasEndNightDawnSent(nightKey), true)
  })

  await withObservatorySiteAsync('cygnus', async () => {
    assert.equal(
      await wasEndNightDawnSent(nightKey),
      false,
      'Cygnus must still close its own dome after Pomfret closed'
    )
  })
})

test('end-night due flag does not cross observatories', async () => {
  const nightKey = '2026-09-05'

  await withObservatorySiteAsync('cygnus', async () => {
    await markEndNightDue(nightKey)
    assert.equal(await isEndNightDue(nightKey), true)
  })

  await withObservatorySiteAsync('pomfret', async () => {
    assert.equal(await isEndNightDue(nightKey), false)
  })
})
