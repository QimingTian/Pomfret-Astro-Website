import assert from 'node:assert/strict'
import test from 'node:test'

import {
  maybeReconcileQueueWhenScheduleWeatherColumnChanged,
  scheduleWeatherColumnFingerprint,
  type ScheduleWeatherColumnPayload,
} from '@/lib/imaging/queue/weather-column-reconcile'

const WINDOW = { start: 1_700_000_000, end: 1_700_050_000 }

function samplePayload(
  overrides: Partial<ScheduleWeatherColumnPayload> = {}
): ScheduleWeatherColumnPayload {
  return {
    prediction: 'permitted',
    hasAnyPrecipitationTonight: false,
    readyHourStartsSec: [1_700_001_000],
    nightHourStartsSec: [1_700_001_000, 1_700_005_000],
    notPermittedHourReasons: [],
    precipitationHitHourStartsSec: [],
    ...overrides,
  }
}

test('scheduleWeatherColumnFingerprint changes when ready hours change', () => {
  const a = scheduleWeatherColumnFingerprint(samplePayload())
  const b = scheduleWeatherColumnFingerprint(
    samplePayload({ readyHourStartsSec: [1_700_002_000] })
  )
  assert.notEqual(a, b)
})

test('scheduleWeatherColumnFingerprint changes for severe rain outside nautical hours', () => {
  const weatherIntervals = {
    status: 'ok' as const,
    permittedIntervals: [{ startMs: 1_700_001_000_000, endMs: 1_700_005_000_000 }],
    globalHardBlocked: false,
  }
  const normal = scheduleWeatherColumnFingerprint(samplePayload({ weatherIntervals }))
  const severe = scheduleWeatherColumnFingerprint(samplePayload({
    weatherIntervals: {
      ...weatherIntervals,
      globalHardBlocked: true,
      severePrecipitationHourStartMs: 1_700_000_000_000,
      severePrecipitationProbability: 81,
    },
  }))
  assert.notEqual(normal, severe)
})

test('maybeReconcileQueueWhenScheduleWeatherColumnChanged skips duplicate fingerprint', async () => {
  const payload = samplePayload()
  await maybeReconcileQueueWhenScheduleWeatherColumnChanged(
    WINDOW.start,
    WINDOW.end,
    payload
  )
  await maybeReconcileQueueWhenScheduleWeatherColumnChanged(
    WINDOW.start,
    WINDOW.end,
    payload
  )
})
