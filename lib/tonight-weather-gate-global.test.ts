import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateGlobalTonightWeatherPermitted,
  isHourWeatherPermitted,
  weatherNotPermittedReasons,
} from '@/lib/tonight-weather-gate'

function hour(sec: number, cloud: number) {
  return {
    hourStartSec: sec,
    cloudCover: cloud,
    precipProbability: 0,
    windSpeedMs: 5,
    transparency: 4 as const,
    seeing: 4 as const,
  }
}

test('weatherNotPermittedReasons includes transparency and seeing when astro is poor', () => {
  const reasons = weatherNotPermittedReasons({
    cloudCover: 5,
    precipProbability: 0,
    windSpeedMs: 5,
    transparency: 5,
    seeing: 3,
  })
  assert.deepEqual(reasons, ['transparency'])
})

test('weatherNotPermittedReasons fails closed when 7Timer astro is missing', () => {
  const reasons = weatherNotPermittedReasons({
    cloudCover: 5,
    precipProbability: 0,
    windSpeedMs: 5,
    transparency: null,
    seeing: null,
  })
  assert.deepEqual(reasons, ['transparency', 'seeing'])
})

test('isHourWeatherPermitted passes when cloud rain wind and astro are all ok', () => {
  assert.equal(
    isHourWeatherPermitted({
      cloudCover: 5,
      precipProbability: 5,
      windSpeedMs: 10,
      transparency: 4,
      seeing: 2,
    }),
    true
  )
})

test('global permitted ignores pre-dusk clear hours outside nautical gate', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = gateStartSec - 2 * 3600
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(16 * 3600, 5),
      hour(17 * 3600, 5),
      hour(20 * 3600, 50),
      hour(21 * 3600, 50),
      hour(22 * 3600, 50),
    ],
  })
  assert.equal(permitted, false)
})

test('global permitted passes when consecutive clear hours fall inside nautical gate', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = gateStartSec - 2 * 3600
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(16 * 3600, 5),
      hour(17 * 3600, 5),
      hour(20 * 3600, 5),
      hour(21 * 3600, 5),
      hour(22 * 3600, 50),
    ],
  })
  assert.equal(permitted, true)
})

test('global permitted ignores fully ended gate hours after nautical dusk', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = 22 * 3600 + 1000
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(20 * 3600, 50),
      hour(21 * 3600, 50),
      hour(22 * 3600, 5),
      hour(23 * 3600, 5),
    ],
  })
  assert.equal(permitted, true)
})

test('global permitted fails when consecutive gate hours have poor seeing', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = gateStartSec - 2 * 3600
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      { ...hour(20 * 3600, 5), seeing: 6 as const },
      { ...hour(21 * 3600, 5), seeing: 6 as const },
      hour(22 * 3600, 5),
    ],
  })
  assert.equal(permitted, false)
})
