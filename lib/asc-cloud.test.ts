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
          cloudCoverPercent: 40,
          cloudConfidence: 0.91,
          modelPhase: 'night',
          frameIso: '2026-06-01T02:00:00+00:00',
          rain: { detected: false, confidence: 0.12, label: 'No Rain' },
          lastError: null,
        },
      },
    },
  }
  const parsed = parseAscCloudFromStatus(payload)
  assert.equal(parsed?.cloudCoverPercent, 40)
  assert.equal(parsed?.modelPhase, 'night')
  assert.equal(parsed?.rain?.label, 'No Rain')
})

test('parseAscCloudFromStatus returns null when missing', () => {
  assert.equal(parseAscCloudFromStatus(null), null)
  assert.equal(parseAscCloudFromStatus({ sensors: {} }), null)
})

test('evaluateObservatoryReadyWeather uses ASC cloud and rain with Open-Meteo wind and precip', () => {
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 9,
      rainDetected: false,
      windSpeedMs: 9,
      precipProbabilityPercent: 20,
    }),
    true
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 99,
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
      cloudCoverPercent: 99,
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
      cloudCoverPercent: 9,
      rainDetected: false,
      windSpeedMs: 9,
      precipProbabilityPercent: 21,
      ascGateApplicable: false,
      openMeteoCloudCoverPercent: 5,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 9,
      rainDetected: false,
      windSpeedMs: 9,
      precipProbabilityPercent: 21,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 10,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 9,
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
      cloudCoverPercent: 10,
      rainDetected: true,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: null,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 10,
      rainDetected: false,
      windSpeedMs: 10,
      precipProbabilityPercent: 0,
    }),
    false
  )
  assert.equal(
    evaluateObservatoryReadyWeather({
      cloudCoverPercent: 9,
      rainDetected: false,
      windSpeedMs: 5,
      precipProbabilityPercent: 0,
    }),
    true
  )
  assert.equal(isAscCloudGateApplicable({ stale: true }, false), false)
  assert.equal(isAscCloudGateApplicable({ cloudCoverPercent: 10 }, true), false)
  assert.equal(isAscCloudGateApplicable({ cloudCoverPercent: 10 }, false), true)
})
