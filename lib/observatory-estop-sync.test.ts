import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRemoteObservatoryModeStatus } from './observatory-status-store'

type GlobalState = typeof globalThis & {
  __pomfret_manual_status__?: string
  __pomfret_mode__?: string
}

function resetMemory(): void {
  const g = globalThis as GlobalState
  delete g.__pomfret_manual_status__
  delete g.__pomfret_mode__
}

test('applyRemoteObservatoryModeStatus ignores stale auto while ESTOP blocking', () => {
  resetMemory()
  const g = globalThis as GlobalState
  g.__pomfret_mode__ = 'manual'
  g.__pomfret_manual_status__ = 'closed_observatory_maintenance'

  applyRemoteObservatoryModeStatus(
    { mode: 'auto', status: 'ready' },
    true
  )

  assert.equal(g.__pomfret_mode__, 'manual')
  assert.equal(g.__pomfret_manual_status__, 'closed_observatory_maintenance')
})

test('applyRemoteObservatoryModeStatus applies remote auto when ESTOP idle', () => {
  resetMemory()
  applyRemoteObservatoryModeStatus({ mode: 'auto', status: 'ready' }, false)
  const g = globalThis as GlobalState
  assert.equal(g.__pomfret_mode__, 'auto')
  assert.equal(g.__pomfret_manual_status__, 'ready')
})
