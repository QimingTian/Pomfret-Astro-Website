import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { computeScheduleInsight, type SchedulePendingRow } from './schedule-insight'
import type { TimeInterval } from '@/lib/tonight-weather-gate'

// Night of 2026-05-31/06-01: moon up (~19°) and ~full near astronomical midnight.
// Target ra 17.23h, dec 50° sits ~78° from the moon (broadband-blocked, Ha-allowed)
// and clears 30° altitude during the night. computeScheduleInsight reads the wall
// clock internally, so we pin it with mocked timers.
const NOW_MS = Date.parse('2026-05-31T20:00:00.000Z')
const RA_HOURS = 17.23
const DEC_DEG = 50

function withMockedNow<T>(fn: () => T): T {
  mock.timers.enable({ apis: ['Date'], now: NOW_MS })
  try {
    return fn()
  } finally {
    mock.timers.reset()
  }
}

// Restrict weather to the part of the night where the moon is high (>10°), so the
// low-altitude moon relaxation does not open an early window. Altitude and weather are
// then identical for every filter — only moon avoidance differs between the rows.
function moonHighWeatherWindow(): TimeInterval[] {
  return [{ startMs: Date.parse('2026-06-01T04:00:00.000Z'), endMs: Date.parse('2026-06-01T05:30:00.000Z') }]
}

function baseRow(overrides: Partial<SchedulePendingRow>): SchedulePendingRow {
  return {
    id: 'row-1',
    createdAt: '2026-05-31T19:00:00.000Z',
    target: 'Moon Test',
    raHours: RA_HOURS,
    decDeg: DEC_DEG,
    exposureSeconds: 60,
    count: 10,
    sequenceTemplate: 'dso',
    ...overrides,
  }
}

// Same target, window, weather and altitude across all three rows — only the filter
// (and the variable-star exemption) differs, so any status change is due to the moon.

test('normal DSO broadband session is unscheduled when the moon is too close', () => {
  withMockedNow(() => {
    const row = baseRow({ filterPlans: [{ filterName: 'L', exposureSeconds: 60, count: 10 }] })
    const insight = computeScheduleInsight([row], row.id, moonHighWeatherWindow())
    assert.equal(insight.status, 'unscheduled')
  })
})

test('same target schedules with a moon-tolerant filter (Ha)', () => {
  withMockedNow(() => {
    const row = baseRow({ id: 'row-ha', filterPlans: [{ filterName: 'H', exposureSeconds: 60, count: 10 }] })
    const insight = computeScheduleInsight([row], row.id, moonHighWeatherWindow())
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
  })
})

test('variable_star session is exempt from moon avoidance', () => {
  withMockedNow(() => {
    const row = baseRow({
      id: 'row-vs',
      sequenceTemplate: 'variable_star',
      filterPlans: [{ filterName: 'L', exposureSeconds: 60, count: 10 }],
    })
    const insight = computeScheduleInsight([row], row.id, moonHighWeatherWindow())
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
  })
})
