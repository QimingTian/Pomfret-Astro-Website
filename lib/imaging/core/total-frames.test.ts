import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFilterFrameProgress, projectFrameCounts } from './total-frames'

test('projectFilterFrameProgress reports captured per filter', () => {
  const rows = projectFilterFrameProgress({
    filterPlansTotal: [
      { filterName: 'R', exposureSeconds: 300, count: 20 },
      { filterName: 'G', exposureSeconds: 300, count: 15 },
    ],
    remainingByFilter: [
      { filterName: 'R', countRemaining: 0 },
      { filterName: 'G', countRemaining: 5 },
    ],
  })
  assert.deepEqual(rows, [
    { filterName: 'R', total: 20, captured: 20 },
    { filterName: 'G', total: 15, captured: 10 },
  ])
  const { total, captured } = projectFrameCounts({
    filterPlansTotal: [
      { filterName: 'R', exposureSeconds: 300, count: 20 },
      { filterName: 'G', exposureSeconds: 300, count: 15 },
    ],
    remainingByFilter: [
      { filterName: 'R', countRemaining: 0 },
      { filterName: 'G', countRemaining: 5 },
    ],
  })
  assert.equal(total, 35)
  assert.equal(captured, 30)
})
