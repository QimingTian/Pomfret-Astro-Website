import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSafetyMonitorPayload } from './safety-monitor-store'

test('parseSafetyMonitorPayload: connected safe sample', () => {
  const parsed = parseSafetyMonitorPayload({
    source: 'pomfret-safety-monitor',
    stationId: 'pomfret',
    connected: true,
    isSafe: true,
    name: 'ASCOM SafetyMonitor',
    displayName: 'Safety',
    deviceId: 'ASCOM.Safety.1',
    clientUtc: '2026-11-25T21:00:00.000Z',
    pluginVersion: '0.2.0',
  })
  assert.ok(parsed)
  assert.equal(parsed!.connected, true)
  assert.equal(parsed!.isSafe, true)
  assert.equal(parsed!.stationId, 'pomfret')
  assert.equal(parsed!.name, 'ASCOM SafetyMonitor')
  assert.equal(parsed!.source, 'pomfret-safety-monitor')
})

test('parseSafetyMonitorPayload: connected requires boolean isSafe', () => {
  assert.equal(parseSafetyMonitorPayload({ connected: true }), null)
  assert.equal(parseSafetyMonitorPayload({ connected: true, isSafe: 'yes' }), null)
})

test('parseSafetyMonitorPayload: disconnected may omit isSafe', () => {
  const parsed = parseSafetyMonitorPayload({
    connected: false,
    source: 'pomfret-safety-monitor',
  })
  assert.ok(parsed)
  assert.equal(parsed!.connected, false)
  assert.equal(parsed!.isSafe, null)
})

test('parseSafetyMonitorPayload: missing connected fails', () => {
  assert.equal(parseSafetyMonitorPayload({ isSafe: true }), null)
})
