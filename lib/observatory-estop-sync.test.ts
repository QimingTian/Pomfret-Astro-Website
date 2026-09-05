import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OBSERVATORY_SITE_ID } from '@/lib/observatory-sites'
import { applyRemoteObservatoryModeStatus } from './observatory-status-store'

type SiteMem = {
  __pomfret_manual_status__?: string
  __pomfret_mode__?: string
}

type GlobalState = typeof globalThis & {
  __pomfret_observatory_memory_by_site__?: Record<string, SiteMem>
}

function siteMem(): SiteMem {
  const g = globalThis as GlobalState
  if (!g.__pomfret_observatory_memory_by_site__) g.__pomfret_observatory_memory_by_site__ = {}
  const id = DEFAULT_OBSERVATORY_SITE_ID
  if (!g.__pomfret_observatory_memory_by_site__[id]) {
    g.__pomfret_observatory_memory_by_site__[id] = {}
  }
  return g.__pomfret_observatory_memory_by_site__[id]!
}

function resetMemory(): void {
  const g = globalThis as GlobalState
  delete g.__pomfret_observatory_memory_by_site__
}

test('applyRemoteObservatoryModeStatus ignores stale auto while ESTOP blocking', () => {
  resetMemory()
  const mem = siteMem()
  mem.__pomfret_mode__ = 'manual'
  mem.__pomfret_manual_status__ = 'closed_observatory_maintenance'

  applyRemoteObservatoryModeStatus({ mode: 'auto', status: 'ready' }, true)

  assert.equal(siteMem().__pomfret_mode__, 'manual')
  assert.equal(siteMem().__pomfret_manual_status__, 'closed_observatory_maintenance')
})

test('applyRemoteObservatoryModeStatus applies remote auto when ESTOP idle', () => {
  resetMemory()
  applyRemoteObservatoryModeStatus({ mode: 'auto', status: 'ready' }, false)
  assert.equal(siteMem().__pomfret_mode__, 'auto')
  assert.equal(siteMem().__pomfret_manual_status__, 'ready')
})
