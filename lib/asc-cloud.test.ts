import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allSkyCameraStatusUrl,
  defaultAllSkyStatusUrl,
  evaluateObservatoryReadyWeather,
  isAscCloudGateApplicable,
  parseAscCloudFromStatus,
} from '@/lib/asc-cloud'

test('allSkyCameraStatusUrl resolves /camera/stream to /camera/status', () => {
  assert.equal(
    allSkyCameraStatusUrl('https://cam.pomfretastro.org/camera/stream'),
    'https://cam.pomfretastro.org/camera/status'
  )
})

test('defaultAllSkyStatusUrl uses production camera host', () => {
  assert.equal(defaultAllSkyStatusUrl(), 'https://cam.pomfretastro.org/camera/status')
})

test('parseAscCloudFromStatus extracts ascCloud payload', () => {
  const payload = {
    sensors: {
      allSkyCam: {
        ascCloud: {
          sky: 'cloudy',
          skyConfidence: 0.91,
          modelPhase: 'night',
          frameIso: '2026-06-01T02:00:00+00:00',
          rain: { detected: false, confidence: 0.12, label: 'No Rain' },
          lastError: null,
        },
      },
    },
  }
  const parsed = parseAscCloudFromStatus(payload)
  assert.equal(parsed?.sky, 'cloudy')
  assert.equal(parsed?.modelPhase, 'night')
  assert.equal(parsed?.rain?.label, 'No Rain')
})

test('parseAscCloudFromStatus returns null when missing', () => {
  assert.equal(parseAscCloudFromStatus(null), null)
  assert.equal(parseAscCloudFromStatus({ sensors: {} }), null)
})

test('evaluateObservatoryReadyWeather uses ASC sky clear and rain with Open-Meteo wind and precip', () => {
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: true,
      rainDetected: false,
      windSpeedMs: 9,
      precipProbabilityPercent: 20,
    }),
    true
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: false,
      openMeteoCloudCoverPercent: 9,
      rainDetected: true,
      windSpeedMs: 9,
      precipProbabilityPercent: 0,
      ascGateApplicable: false,
    }),
    true
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: false,
      openMeteoCloudCoverPercent: 12,
      rainDetected: true,
      windSpeedMs: 9,
      precipProbabilityPercent: 0,
      ascGateApplicable: false,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: true,
      rainDetected: false,
      windSpeedMs: 9,
      precipProbabilityPercent: 21,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: true,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    true
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: false,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: true,
      rainDetected: true,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: null,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  // Legacy TM percent fallback when sky missing
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 19,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    true
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 20,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      ascSkyClear: true,
      rainDetected: false,
      windSpeedMs: 10,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(isAscCloudGateApplicable({ stale: true }, false), false)
  assert.equal(isAscCloudGateApplicable({ sky: 'clear' }, true), false)
  assert.equal(isAscCloudGateApplicable({ sky: 'clear' }, false), true)
})
