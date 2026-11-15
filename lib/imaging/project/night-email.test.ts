import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectFilterProgressEmailLines,
  projectSubSessionEmailTarget,
} from '@/lib/imaging/project/night-email'

test('projectSubSessionEmailTarget uses Session N', () => {
  assert.equal(
    projectSubSessionEmailTarget('North America Nebula', { nightIndex: 3 }),
    "North America Nebula's Session 3"
  )
})

test('projectSubSessionEmailTarget uses mosaic Session P-S', () => {
  assert.equal(
    projectSubSessionEmailTarget('M42', {
      nightIndex: 7,
      mosaicPanelIndex: 2,
      mosaicSubIndex: 1,
    }),
    "M42's Session 2-1"
  )
})

test('projectFilterProgressEmailLines formats captured/total', () => {
  const lines = projectFilterProgressEmailLines({
    filterPlansTotal: [
      { filterName: 'Ha', exposureSeconds: 300, count: 300 },
      { filterName: 'OIII', exposureSeconds: 300, count: 200 },
    ],
    remainingByFilter: [
      { filterName: 'Ha', countRemaining: 50 },
      { filterName: 'OIII', countRemaining: 100 },
    ],
  })
  assert.deepEqual(lines, ['Ha -- 250/300', 'OIII -- 100/200'])
})
