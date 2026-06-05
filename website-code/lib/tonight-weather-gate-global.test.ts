import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateGlobalTonightWeatherPermitted } from '@/lib/tonight-weather-gate'

function hour(sec: number, cloud: number) {
  return {
    hourStartSec: sec,
    cloudCover: cloud,
    precipProbability: 0,
    windSpeedMs: 5,
  }
}

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
