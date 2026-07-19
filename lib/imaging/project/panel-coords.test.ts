import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skyCoordsForMosaicPanel } from '@/lib/imaging/project/panel-coords'

test('skyCoordsForMosaicPanel returns panel coords by 1-based index', () => {
  const project = {
    raHours: 1,
    decDeg: 10,
    mosaicMode: true,
    mosaicPanels: [
      { raHours: 2, decDeg: 20 },
      { raHours: 3, decDeg: 30 },
    ],
  }
  assert.deepEqual(skyCoordsForMosaicPanel(project, 1), { raHours: 2, decDeg: 20 })
  assert.deepEqual(skyCoordsForMosaicPanel(project, 2), { raHours: 3, decDeg: 30 })
})

test('skyCoordsForMosaicPanel falls back to project center', () => {
  const project = { raHours: 1, decDeg: 10, mosaicMode: false }
  assert.deepEqual(skyCoordsForMosaicPanel(project, 2), { raHours: 1, decDeg: 10 })
})
