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

test('imaging equipment Redis keys are site-scoped', async () => {
  const { imagingEquipmentKvKey } = await import('@/lib/imaging/equipment/equipment-store')
  await withObservatorySiteAsync(POMFRET_SITE.id, async () => {
    assert.equal(imagingEquipmentKvKey(), 'pomfret:imaging-equipment')
  })
  await withObservatorySiteAsync(CYGNUS_SITE.id, async () => {
    assert.equal(imagingEquipmentKvKey(), 'site:cygnus:imaging-equipment')
  })
})

test('live-bus and mount memory keys do not collide across sites', async () => {
  const { scopedKvKey } = await import('@/lib/observatory-site-scope')
  await withObservatorySiteAsync(POMFRET_SITE.id, async () => {
    assert.equal(scopedKvKey('live:mount:default'), 'live:mount:default')
    assert.equal(scopedKvKey('imaging-preview-meta:q1'), 'imaging-preview-meta:q1')
  })
  await withObservatorySiteAsync(CYGNUS_SITE.id, async () => {
    assert.equal(scopedKvKey('live:mount:default'), 'site:cygnus:live:mount:default')
    assert.equal(scopedKvKey('imaging-preview-meta:q1'), 'site:cygnus:imaging-preview-meta:q1')
  })
})
