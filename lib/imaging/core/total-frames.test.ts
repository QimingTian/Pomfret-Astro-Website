import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isOpenEndedVariableStarSession,
  projectFilterFrameProgress,
  projectFrameCounts,
} from './total-frames'
import {
  formatVariableStarImagingPlan,
  variableStarMonitorUntilMs,
} from '../nina/variable-star-plan-label'

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

test('projectFilterFrameProgress labels mosaic filters as Panel N -- filter', () => {
  const rows = projectFilterFrameProgress({
    filterPlansTotal: [
      { filterName: 'S', exposureSeconds: 300, count: 10 },
      { filterName: 'H', exposureSeconds: 300, count: 8 },
    ],
    remainingByFilter: [
      { filterName: 'S', countRemaining: 6 },
      { filterName: 'H', countRemaining: 8 },
    ],
    mosaicMode: true,
    mosaicPanels: [
      { id: 1, name: 'Panel 1' },
      { id: 2, name: 'Panel 2' },
    ],
    mosaicFilterPlansByPanel: [
      [{ filterName: 'S', exposureSeconds: 300, count: 10 }],
      [{ filterName: 'H', exposureSeconds: 300, count: 8 }],
    ],
    mosaicRemainingByPanel: [
      [{ filterName: 'S', countRemaining: 4 }],
      [{ filterName: 'H', countRemaining: 8 }],
    ],
  })
  assert.deepEqual(rows, [
    { filterName: 'Panel 1 -- S', total: 10, captured: 6 },
    { filterName: 'Panel 2 -- H', total: 8, captured: 0 },
  ])
})

test('isOpenEndedVariableStarSession detects template and legacy G×1 plan', () => {
  assert.equal(isOpenEndedVariableStarSession({ sequenceTemplate: 'variable_star' }), true)
  assert.equal(isOpenEndedVariableStarSession({ sequenceTemplate: 'dso', filterPlans: [{ filterName: 'G', exposureSeconds: 30, count: 1 }] }), false)
  assert.equal(
    isOpenEndedVariableStarSession({
      filterPlans: [{ filterName: 'G', exposureSeconds: 30, count: 1 }],
    }),
    true
  )
  assert.equal(
    isOpenEndedVariableStarSession({
      filterPlans: [{ filterName: 'G', exposureSeconds: 30, count: 10 }],
    }),
    false
  )
})

test('formatVariableStarImagingPlan uses monitor-until and ADU percent', () => {
  const untilMs = Date.parse('2026-08-26T05:30:00.000Z')
  const label = formatVariableStarImagingPlan({
    untilMs,
    amplitudeMag: 1.1,
    filterName: 'G',
  })
  assert.match(label, /^G · Monitor until /)
  assert.match(label, /Dynamic exposure/)
  assert.match(label, /Target ADU 30%$/)
  assert.equal(variableStarMonitorUntilMs({ scheduleBarEndMs: untilMs }), untilMs)
  assert.equal(
    variableStarMonitorUntilMs({
      plannedStartIso: '2026-08-26T02:00:00.000Z',
      estimatedDurationSeconds: 3600,
    }),
    Date.parse('2026-08-26T03:00:00.000Z')
  )
})
