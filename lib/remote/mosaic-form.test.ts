import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMosaicPanel,
  cloneFilterPlanForms,
  mosaicDraftFromCoords,
  toMosaicDraftPanel,
} from './mosaic-form'

test('cloneFilterPlanForms deep-copies rows', () => {
  const src = [{ filterName: 'L', count: '10', exposureSeconds: '300' }]
  const cloned = cloneFilterPlanForms(src)
  assert.notEqual(cloned, src)
  assert.deepEqual(cloned, src)
  cloned[0]!.count = '20'
  assert.equal(src[0]!.count, '10')
})

test('buildMosaicPanel sets defaults', () => {
  const p = buildMosaicPanel(2, 5.5, -10)
  assert.equal(p.id, 2)
  assert.equal(p.name, 'Panel 2')
  assert.equal(p.positionAngleDeg, 0)
  assert.equal(p.screenDeltaXPx, 0)
})

test('mosaicDraftFromCoords carries center and panels', () => {
  const panel = buildMosaicPanel(1, 1, 2)
  const draft = mosaicDraftFromCoords([panel], 'M42', 1, 2)
  assert.equal(draft.targetName, 'M42')
  assert.equal(draft.centerRaHours, 1)
  assert.deepEqual(draft.panels, [panel])
})

test('toMosaicDraftPanel fills missing name and PA', () => {
  const p = toMosaicDraftPanel({ id: 3, raHours: 1, decDeg: 2 })
  assert.equal(p.name, 'Panel 3')
  assert.equal(p.positionAngleDeg, 0)
})
