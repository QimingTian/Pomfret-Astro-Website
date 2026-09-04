import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRemoteObservatoryModeStatus } from './observatory-status-store'

type SiteMemory = {
  __pomfret_manual_status__?: string
  __pomfret_mode__?: string
}

type GlobalState = typeof globalThis & {
  __pomfret_observatory_memory_by_site__?: Record<string, SiteMemory>
}

/** Observatory memory is per site; tests run with no ALS, so the site is Pomfret. */
function siteMemory(): SiteMemory {
  const g = globalThis as GlobalState
  if (!g.__pomfret_observatory_memory_by_site__) g.__pomfret_observatory_memory_by_site__ = {}
  if (!g.__pomfret_observatory_memory_by_site__.pomfret) {
    g.__pomfret_observatory_memory_by_site__.pomfret = {}
  }
  return g.__pomfret_observatory_memory_by_site__.pomfret
}

function resetMemory(): void {
  const mem = siteMemory()
  delete mem.__pomfret_manual_status__
  delete mem.__pomfret_mode__
}

test('applyRemoteObservatoryModeStatus ignores stale auto while ESTOP blocking', () => {
  resetMemory()
  const mem = siteMemory()
  mem.__pomfret_mode__ = 'manual'
  mem.__pomfret_manual_status__ = 'closed_observatory_maintenance'

  applyRemoteObservatoryModeStatus(
    { mode: 'auto', status: 'ready' },
    true
  )

  assert.equal(mem.__pomfret_mode__, 'manual')
  assert.equal(mem.__pomfret_manual_status__, 'closed_observatory_maintenance')
})

test('applyRemoteObservatoryModeStatus applies remote auto when ESTOP idle', () => {
  resetMemory()
  applyRemoteObservatoryModeStatus({ mode: 'auto', status: 'ready' }, false)
  const mem = siteMemory()
  assert.equal(mem.__pomfret_mode__, 'auto')
  assert.equal(mem.__pomfret_manual_status__, 'ready')
})
