import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRECIP_ESTOP_THRESHOLD,
  STORM_APPROACH_RADIUS_KM,
  isThunderstormWeatherCode,
  pickWeatherSafetyThreat,
  precipThreatAtOrAbove,
  ringSampleCoordinates,
} from './weather-safety-estop'

test('isThunderstormWeatherCode accepts WMO thunder codes only', () => {
  assert.equal(isThunderstormWeatherCode(95), true)
  assert.equal(isThunderstormWeatherCode(96), true)
  assert.equal(isThunderstormWeatherCode(99), true)
  assert.equal(isThunderstormWeatherCode(61), false)
  assert.equal(isThunderstormWeatherCode(3), false)
})

test('precipThreatAtOrAbove matches gate threshold', () => {
  assert.equal(precipThreatAtOrAbove(10), true)
  assert.equal(precipThreatAtOrAbove(9.9), false)
  assert.equal(precipThreatAtOrAbove(20, PRECIP_ESTOP_THRESHOLD), true)
  assert.equal(precipThreatAtOrAbove(Number.NaN), false)
})

test('ringSampleCoordinates includes center plus N bearings at radius', () => {
  const points = ringSampleCoordinates(41.9159, -71.9626, STORM_APPROACH_RADIUS_KM, 8)
  assert.equal(points.length, 9)
  assert.equal(points[0]!.distanceKm, 0)
  for (const p of points.slice(1)) {
    assert.ok(Math.abs(p.distanceKm - STORM_APPROACH_RADIUS_KM) < 1e-9)
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon))
  }
  // North sample should be roughly +radius in latitude
  const north = points.find((p) => p.bearingDeg === 0 && p.distanceKm > 0)
  assert.ok(north)
  assert.ok(north!.lat > 41.9159)
})

test('pickWeatherSafetyThreat prefers ASC rain', () => {
  const nowSec = Date.parse('2026-07-10T02:30:00.000Z') / 1000
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: true,
    siteHours: [
      { timeSec: nowSec - 1800, precipProbability: 0, weatherCode: 0 },
      { timeSec: nowSec + 1800, precipProbability: 0, weatherCode: 0 },
    ],
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat?.kind, 'asc_rain')
})

test('pickWeatherSafetyThreat flags site current-hour precip >= 10%', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 10 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    siteHours: [
      { timeSec: hourStart, precipProbability: 20, weatherCode: 3 },
      { timeSec: hourStart + 3600, precipProbability: 0, weatherCode: 0 },
    ],
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat?.kind, 'site_precip_forecast')
  assert.equal(threat?.detail.hour, 'current')
  assert.equal(threat?.detail.precipProbability, 20)
})

test('pickWeatherSafetyThreat flags site next-hour precip >= 10%', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 10 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    siteHours: [
      { timeSec: hourStart, precipProbability: 0, weatherCode: 0 },
      { timeSec: hourStart + 3600, precipProbability: 15, weatherCode: 61 },
    ],
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat?.kind, 'site_precip_forecast')
  assert.equal(threat?.detail.hour, 'next')
})

test('pickWeatherSafetyThreat flags thunderstorm on 20 km ring', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    siteHours: [
      { timeSec: hourStart, precipProbability: 0, weatherCode: 0 },
      { timeSec: hourStart + 3600, precipProbability: 0, weatherCode: 0 },
    ],
    ringLocations: [
      {
        lat: 42.1,
        lon: -71.96,
        distanceKm: STORM_APPROACH_RADIUS_KM,
        hours: [
          { timeSec: hourStart, precipProbability: 40, weatherCode: 95 },
          { timeSec: hourStart + 3600, precipProbability: 10, weatherCode: 3 },
        ],
      },
    ],
    nowSec,
  })
  assert.equal(threat?.kind, 'storm_approach')
  assert.equal(threat?.detail.weatherCode, 95)
  assert.equal(threat?.detail.distanceKm, STORM_APPROACH_RADIUS_KM)
})

test('pickWeatherSafetyThreat returns null when clear', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    siteHours: [
      { timeSec: hourStart, precipProbability: 5, weatherCode: 2 },
      { timeSec: hourStart + 3600, precipProbability: 0, weatherCode: 1 },
    ],
    ringLocations: [
      {
        lat: 42.1,
        lon: -71.96,
        distanceKm: STORM_APPROACH_RADIUS_KM,
        hours: [
          { timeSec: hourStart, precipProbability: 5, weatherCode: 61 },
          { timeSec: hourStart + 3600, precipProbability: 0, weatherCode: 0 },
        ],
      },
    ],
    nowSec,
  })
  assert.equal(threat, null)
})
