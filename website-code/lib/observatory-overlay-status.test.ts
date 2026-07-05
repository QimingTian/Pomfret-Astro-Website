import assert from 'node:assert/strict'
import test from 'node:test'
import { computeOverlayObservatoryStatus } from '@/lib/observatory-overlay-status'

test('computeOverlayObservatoryStatus uses live weather in auto when server status is stale ready', () => {
  const status = computeOverlayObservatoryStatus({
    mode: 'auto',
    serverStatus: 'ready',
    cloudPct: 100,
    rainDetected: false,
    windKmh: 11,
    now: new Date('2026-07-02T02:54:51.000Z'),
  })
  assert.equal(status, 'closed_weather_not_permitted')
})

test('computeOverlayObservatoryStatus keeps manual status even when clouds are high', () => {
  const status = computeOverlayObservatoryStatus({
    mode: 'manual',
    serverStatus: 'ready',
    cloudPct: 100,
    rainDetected: false,
    windKmh: 11,
  })
  assert.equal(status, 'ready')
})

test('computeOverlayObservatoryStatus preserves disconnected over live weather', () => {
  const status = computeOverlayObservatoryStatus({
    mode: 'auto',
    serverStatus: 'disconnected',
    cloudPct: 0,
    rainDetected: false,
    windKmh: 5,
  })
  assert.equal(status, 'disconnected')
})
