import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEngineResolveCandidates } from './plan-engine-search'

test('buildEngineResolveCandidates expands NGC/IC compact and spaced forms', () => {
  const got = buildEngineResolveCandidates({ canonicalName: 'NGC 7000', aliases: ['North America Nebula'] }, 'ngc7000')
  assert.ok(got.includes('NGC 7000'))
  assert.ok(got.includes('NGC7000'))
  assert.ok(got.includes('ngc7000'))
  assert.ok(got.includes('North America Nebula'))
})

test('buildEngineResolveCandidates expands LDN/Barnard designations', () => {
  const ldn = buildEngineResolveCandidates({ canonicalName: 'LDN 1622', aliases: [] }, 'ldn1622')
  assert.ok(ldn.includes('LDN 1622'))
  assert.ok(ldn.includes('LDN1622'))
  const barnard = buildEngineResolveCandidates({ canonicalName: 'Barnard 33', aliases: ['Horsehead'] }, 'B33')
  assert.ok(barnard.includes('B 33'))
  assert.ok(barnard.includes('B33'))
})
