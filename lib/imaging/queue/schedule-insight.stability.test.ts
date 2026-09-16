import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { computeScheduleInsight, type SchedulePendingRow } from './schedule-insight'
import { PROJECT_HOLD_START_MARGIN_MS } from '@/lib/imaging-project-altitude-hold'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import type { TimeInterval } from '@/lib/tonight-weather-gate'

// Rows carry no RA/Dec on purpose: altitude rules are exercised elsewhere, and leaving them out
// isolates planned-start stability and the project-reservation margin. computeScheduleInsight reads
// the wall clock internally, so every case pins it.
const NOW_MS = Date.parse('2026-05-18T02:00:00.000Z')

function withMockedNow<T>(fn: (nowMs: number) => T): T {
  mock.timers.enable({ apis: ['Date'], now: NOW_MS })
  try {
    return fn(NOW_MS)
  } finally {
    mock.timers.reset()
  }
}

function openWeatherTonight(): TimeInterval[] {
  const window = getTonightSchedulingWindow(new Date(NOW_MS))
  return [{ startMs: window.nauticalDuskUtc.getTime(), endMs: window.nauticalDawnUtc.getTime() }]
}

/** Reconcile always re-places the target row as pending and passes its published start separately. */
function row(overrides: Partial<SchedulePendingRow>): SchedulePendingRow {
  return {
    id: 'row-1',
    createdAt: new Date(NOW_MS - 30 * 60_000).toISOString(),
    target: 'Stability Test',
    exposureSeconds: 60,
    count: 10,
    estimatedDurationSeconds: 20 * 60,
    sequenceTemplate: 'dso',
    status: 'pending',
    plannedStartIso: null,
    ...overrides,
  }
}

test('planned start is re-derived to now when no published start is supplied', () => {
  withMockedNow((nowMs) => {
    const published = new Date(nowMs - 5 * 60_000).toISOString()
    const insight = computeScheduleInsight([row({})], 'row-1', openWeatherTonight())
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
    assert.notEqual(insight.plannedStartIso, published)
    assert.ok(Date.parse(insight.plannedStartIso!) >= nowMs)
  })
})

test('an overdue published start is re-derived so the strip and occupancy stay honest', () => {
  withMockedNow((nowMs) => {
    const published = new Date(nowMs - 5 * 60_000).toISOString()
    const insight = computeScheduleInsight([row({})], 'row-1', openWeatherTonight(), {
      preferredStartMsForTarget: Date.parse(published),
    })
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
    assert.notEqual(insight.plannedStartIso, published)
    assert.ok(Date.parse(insight.plannedStartIso!) >= nowMs)
  })
})

test('a still-future published start survives a slightly later re-placement', () => {
  withMockedNow((nowMs) => {
    // Weather opens off the search grid, so re-placing lands two minutes later than the value the
    // row already carries. The published start still passes every rule, so it must win.
    const weather = [
      { startMs: nowMs + 2 * 3600_000 + 6 * 60_000, endMs: nowMs + 5 * 3600_000 },
    ]
    const published = new Date(nowMs + 2 * 3600_000 + 3 * 60_000).toISOString()

    const fresh = computeScheduleInsight([row({})], 'row-1', weather)
    assert.equal(fresh.status, 'scheduled', fresh.reasons.join(' | '))
    assert.ok(
      Date.parse(fresh.plannedStartIso!) > Date.parse(published),
      `re-placement should land later than the published start, got ${fresh.plannedStartIso}`
    )

    const kept = computeScheduleInsight([row({})], 'row-1', weather, {
      preferredStartMsForTarget: Date.parse(published),
    })
    assert.equal(kept.plannedStartIso, published)
  })
})

test('a published start whose window already elapsed is re-placed', () => {
  withMockedNow((nowMs) => {
    const published = new Date(nowMs - 3 * 3600_000).toISOString()
    const insight = computeScheduleInsight([row({})], 'row-1', openWeatherTonight(), {
      preferredStartMsForTarget: Date.parse(published),
    })
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
    assert.notEqual(insight.plannedStartIso, published)
    assert.ok(Date.parse(insight.plannedStartIso!) >= nowMs)
  })
})

test('a materially earlier slot wins over the published start', () => {
  withMockedNow((nowMs) => {
    const published = new Date(nowMs + 2 * 3600_000).toISOString()
    const insight = computeScheduleInsight([row({})], 'row-1', openWeatherTonight(), {
      preferredStartMsForTarget: Date.parse(published),
    })
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
    assert.ok(
      Date.parse(insight.plannedStartIso!) < nowMs + 10 * 60_000,
      `expected the freed-up earlier slot, got ${insight.plannedStartIso}`
    )
  })
})

test('a session that would overrun into a project reservation is placed behind it', () => {
  withMockedNow((nowMs) => {
    const reserved = { startMs: nowMs + 40 * 60_000, endMs: nowMs + 3 * 3600_000 }
    const candidate = row({ estimatedDurationSeconds: 35 * 60 })

    const withoutMargin = computeScheduleInsight([candidate], 'row-1', openWeatherTonight(), {
      reservedIntervals: [reserved],
    })
    assert.ok(
      Date.parse(withoutMargin.plannedStartIso!) < reserved.startMs,
      'without a margin the 35-minute session squeezes into the 40-minute gap'
    )

    const withMargin = computeScheduleInsight([candidate], 'row-1', openWeatherTonight(), {
      reservedIntervals: [reserved],
      reservedStartMarginMs: PROJECT_HOLD_START_MARGIN_MS,
    })
    assert.equal(withMargin.status, 'scheduled', withMargin.reasons.join(' | '))
    assert.ok(
      Date.parse(withMargin.plannedStartIso!) >= reserved.endMs,
      `expected placement behind the reservation, got ${withMargin.plannedStartIso}`
    )
  })
})

test('tonight regression: short session takes the gap, long session waits out the trimmed hold', () => {
  withMockedNow((nowMs) => {
    // M33 Session 5 is the project's final sub, so the reservation ends with it instead of dawn.
    const reserved = { startMs: nowMs + 90 * 60_000, endMs: nowMs + 2 * 3600_000 }
    const supernova = row({
      id: 'sn-2026aaiv',
      target: 'SN 2026aaiv',
      createdAt: new Date(nowMs - 7 * 60_000).toISOString(),
      estimatedDurationSeconds: 70 * 60,
    })
    const variableStar = row({
      id: 'xz-dra',
      target: 'XZ Dra',
      createdAt: new Date(nowMs - 6 * 60_000).toISOString(),
      estimatedDurationSeconds: 3 * 3600,
    })
    const options = {
      reservedIntervals: [reserved],
      reservedStartMarginMs: PROJECT_HOLD_START_MARGIN_MS,
    }

    const snInsight = computeScheduleInsight([supernova, variableStar], 'sn-2026aaiv', openWeatherTonight(), options)
    assert.equal(snInsight.status, 'scheduled', snInsight.reasons.join(' | '))
    const snStartMs = Date.parse(snInsight.plannedStartIso!)
    assert.ok(snStartMs < reserved.startMs, 'supernova should use the gap before the project')
    assert.ok(
      snStartMs + 70 * 60_000 + PROJECT_HOLD_START_MARGIN_MS <= reserved.startMs,
      'supernova must clear the reservation with the full margin'
    )

    const xzInsight = computeScheduleInsight([supernova, variableStar], 'xz-dra', openWeatherTonight(), options)
    assert.equal(xzInsight.status, 'scheduled', xzInsight.reasons.join(' | '))
    assert.ok(
      Date.parse(xzInsight.plannedStartIso!) >= reserved.endMs,
      `expected XZ Dra after the trimmed hold, got ${xzInsight.plannedStartIso}`
    )
  })
})
