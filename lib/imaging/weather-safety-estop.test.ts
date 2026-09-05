import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD,
  PRECIP_ESTOP_THRESHOLD,
  STORM_APPROACH_RADIUS_KM,
  ascRainThreat,
  isThunderstormWeatherCode,
  isWeatherSafetyClearForAutoUnlock,
  weatherSafetyClearHoldElapsed,
  WEATHER_SAFETY_CLEAR_HOLD_MS,
  pickSitePrecipThreat,
  pickStormApproachThreat,
  pickWeatherSafetyThreat,
  precipThreatAbove,
  ringSampleCoordinates,
} from './weather-safety-estop'

test('isThunderstormWeatherCode accepts WMO thunder codes only', () => {
  assert.equal(isThunderstormWeatherCode(95), true)
  assert.equal(isThunderstormWeatherCode(96), true)
  assert.equal(isThunderstormWeatherCode(99), true)
  assert.equal(isThunderstormWeatherCode(61), false)
  assert.equal(isThunderstormWeatherCode(3), false)
})

test('precipThreatAbove is strict greater-than threshold', () => {
  assert.equal(precipThreatAbove(20), false)
  assert.equal(precipThreatAbove(20.1), true)
  assert.equal(precipThreatAbove(21, PRECIP_ESTOP_THRESHOLD), true)
  assert.equal(precipThreatAbove(Number.NaN), false)
})

test('ascRainThreat requires detected=true AND confidence >=99%', () => {
  assert.equal(ascRainThreat({ detected: true, confidence: 0.99 }), true)
  assert.equal(ascRainThreat({ detected: true, confidence: 0.989 }), false)
  assert.equal(ascRainThreat({ detected: false, confidence: 1 }), false)
  assert.equal(ascRainThreat({ detected: true, confidence: 1 }), true)
  assert.equal(ascRainThreat({ detected: undefined, confidence: 1 }), false)
  assert.equal(ascRainThreat(null), false)
  assert.equal(
    ascRainThreat({ detected: true, confidence: ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD }),
    true
  )
})

test('ringSampleCoordinates includes center plus N bearings at radius', () => {
  const points = ringSampleCoordinates(41.9159, -71.9626, STORM_APPROACH_RADIUS_KM, 8)
  assert.equal(points.length, 9)
  assert.equal(points[0]!.distanceKm, 0)
  for (const p of points.slice(1)) {
    assert.ok(Math.abs(p.distanceKm - STORM_APPROACH_RADIUS_KM) < 1e-9)
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon))
  }
  const north = points.find((p) => p.bearingDeg === 0 && p.distanceKm > 0)
  assert.ok(north)
  assert.ok(north!.lat > 41.9159)
})

test('pickWeatherSafetyThreat prefers thunderstorm over precip and ASC', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: true,
    ascRainConfidence: 0.995,
    ringLocations: [
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [{ timeSec: hourStart, precipProbability: 80, weatherCode: 61 }],
      },
      {
        lat: 42.1,
        lon: -71.96,
        distanceKm: STORM_APPROACH_RADIUS_KM,
        hours: [{ timeSec: hourStart, precipProbability: 40, weatherCode: 95 }],
      },
    ],
    nowSec,
  })
  assert.equal(threat?.kind, 'storm_approach')
})

test('pickWeatherSafetyThreat flags site precip >20% when no storm', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 10 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    ascRainConfidence: 0.5,
    ringLocations: [
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [
          { timeSec: hourStart, precipProbability: 21, weatherCode: 61 },
          { timeSec: hourStart + 3600, precipProbability: 5, weatherCode: 61 },
        ],
      },
    ],
    nowSec,
  })
  assert.equal(threat?.kind, 'site_precip')
  assert.equal(threat?.detail.precipProbability, 21)
})

test('pickWeatherSafetyThreat ignores site precip at exactly 20%', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 10 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    ascRainConfidence: 0.5,
    ringLocations: [
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [{ timeSec: hourStart, precipProbability: 20, weatherCode: 61 }],
      },
    ],
    nowSec,
  })
  assert.equal(threat, null)
})

test('pickSitePrecipThreat only uses observatory center current hour', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const threat = pickSitePrecipThreat({
    ringLocations: [
      {
        lat: 42.1,
        lon: -71.96,
        distanceKm: STORM_APPROACH_RADIUS_KM,
        hours: [{ timeSec: hourStart, precipProbability: 90, weatherCode: 61 }],
      },
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [{ timeSec: hourStart, precipProbability: 25, weatherCode: 61 }],
      },
    ],
    nowSec,
  })
  assert.equal(threat?.kind, 'site_precip')
  assert.equal(threat?.detail.precipProbability, 25)
})

test('pickWeatherSafetyThreat flags ASC rain when detected and confidence >=99%', () => {
  const nowSec = Date.parse('2026-07-10T02:30:00.000Z') / 1000
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: true,
    ascRainConfidence: 0.99,
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat?.kind, 'asc_rain')
  assert.equal(threat?.detail.ascRainConfidence, 0.99)
})

test('pickWeatherSafetyThreat ignores high ASC confidence when detected=false', () => {
  const nowSec = Date.parse('2026-07-10T02:30:00.000Z') / 1000
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    ascRainConfidence: 1,
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat, null)
})

test('pickWeatherSafetyThreat ignores ASC rain below 99% even when detected', () => {
  const nowSec = Date.parse('2026-07-10T02:30:00.000Z') / 1000
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: true,
    ascRainConfidence: 0.989,
    ringLocations: [],
    nowSec,
  })
  assert.equal(threat, null)
})

test('pickWeatherSafetyThreat flags thunderstorm on 20 km ring', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const ringLocations = [
    {
      lat: 42.1,
      lon: -71.96,
      distanceKm: STORM_APPROACH_RADIUS_KM,
      hours: [
        { timeSec: hourStart, precipProbability: 40, weatherCode: 95 },
        { timeSec: hourStart + 3600, precipProbability: 10, weatherCode: 3 },
      ],
    },
  ]
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    ascRainConfidence: 0.5,
    ringLocations,
    nowSec,
  })
  assert.equal(threat?.kind, 'storm_approach')
  assert.equal(threat?.detail.weatherCode, 95)
  assert.equal(threat?.detail.distanceKm, STORM_APPROACH_RADIUS_KM)
  const stormOnly = pickStormApproachThreat({ ringLocations, nowSec })
  assert.equal(stormOnly?.kind, 'storm_approach')
  assert.equal(stormOnly?.detail.weatherCode, 95)
})

test('pickWeatherSafetyThreat returns null when clear', () => {
  const hourStart = Date.parse('2026-07-10T02:00:00.000Z') / 1000
  const nowSec = hourStart + 5 * 60
  const threat = pickWeatherSafetyThreat({
    ascRainDetected: false,
    ascRainConfidence: 0.5,
    ringLocations: [
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [
          { timeSec: hourStart, precipProbability: 10, weatherCode: 61 },
          { timeSec: hourStart + 3600, precipProbability: 0, weatherCode: 0 },
        ],
      },
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

test('isWeatherSafetyClearForAutoUnlock requires Open-Meteo and ASC both available and clear', () => {
  assert.equal(
    isWeatherSafetyClearForAutoUnlock({
      threat: null,
      openMeteoAvailable: true,
      ascGateApplicable: true,
    }),
    true
  )
  assert.equal(
    isWeatherSafetyClearForAutoUnlock({
      threat: null,
      openMeteoAvailable: false,
      ascGateApplicable: true,
    }),
    false
  )
  assert.equal(
    isWeatherSafetyClearForAutoUnlock({
      threat: null,
      openMeteoAvailable: true,
      ascGateApplicable: false,
    }),
    false
  )
  assert.equal(
    isWeatherSafetyClearForAutoUnlock({
      threat: {
        kind: 'site_precip',
        reason: 'precip',
        detail: {},
      },
      openMeteoAvailable: true,
      ascGateApplicable: true,
    }),
    false
  )
})

test('isWeatherSafetyClearForAutoUnlock on non-ASC sites requires Open-Meteo only', async () => {
  const { withObservatorySiteAsync } = await import('@/lib/observatory-site-scope')
  await withObservatorySiteAsync('cygnus', async () => {
    assert.equal(
      isWeatherSafetyClearForAutoUnlock({
        threat: null,
        openMeteoAvailable: true,
        ascGateApplicable: false,
      }),
      true
    )
    assert.equal(
      isWeatherSafetyClearForAutoUnlock({
        threat: null,
        openMeteoAvailable: false,
        ascGateApplicable: false,
      }),
      false
    )
    assert.equal(
      isWeatherSafetyClearForAutoUnlock({
        threat: {
          kind: 'site_precip',
          reason: 'precip',
          detail: {},
        },
        openMeteoAvailable: true,
        ascGateApplicable: false,
      }),
      false
    )
  })
})

test('weatherSafetyClearHoldElapsed requires 20 minutes of continuous clear', () => {
  const start = Date.parse('2026-08-23T05:00:00.000Z')
  assert.equal(weatherSafetyClearHoldElapsed(null, start + WEATHER_SAFETY_CLEAR_HOLD_MS), false)
  assert.equal(weatherSafetyClearHoldElapsed(start, start + 60_000), false)
  assert.equal(weatherSafetyClearHoldElapsed(start, start + WEATHER_SAFETY_CLEAR_HOLD_MS - 1), false)
  assert.equal(weatherSafetyClearHoldElapsed(start, start + WEATHER_SAFETY_CLEAR_HOLD_MS), true)
})
