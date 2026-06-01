import assert from 'node:assert/strict'
import test from 'node:test'
import { isObservatoryAgentDisconnected, isObservatoryBusyFromNinaReport } from '@/lib/observatory-status-store'

test('isObservatoryBusyFromNinaReport is true while agent reports NINA running within stale window', () => {
  const now = 1_000_000
  assert.equal(isObservatoryBusyFromNinaReport(now, true, now - 30_000), true)
})

test('isObservatoryBusyFromNinaReport is false when agent reports NINA not running', () => {
  assert.equal(isObservatoryBusyFromNinaReport(Date.now(), false, Date.now()), false)
})

test('isObservatoryBusyFromNinaReport is false when last NINA-running report is stale', () => {
  const now = 1_000_000
  assert.equal(isObservatoryBusyFromNinaReport(now, true, now - 120_000), false)
})

test('isObservatoryAgentDisconnected is true when agent has never been seen', () => {
  assert.equal(isObservatoryAgentDisconnected(Date.now(), 0), true)
})

test('isObservatoryAgentDisconnected is false with recent agent heartbeat', () => {
  const now = 1_000_000
  assert.equal(isObservatoryAgentDisconnected(now, now - 30_000), false)
})
