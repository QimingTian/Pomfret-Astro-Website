import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPlanObjectName, planSessionNameForRemote } from './plan-target-name'

test('formatPlanObjectName strips NAME prefix and trims', () => {
  assert.equal(formatPlanObjectName('NAME M31'), 'M31')
  assert.equal(formatPlanObjectName('  NGC 7000 '), 'NGC 7000')
  assert.equal(formatPlanObjectName(''), '')
  assert.equal(formatPlanObjectName(null), '')
})

test('planSessionNameForRemote prefers tracking name then selection, else blank', () => {
  assert.equal(planSessionNameForRemote({ trackingName: 'M42', selectionId: 'NAME Sun' }), 'M42')
  assert.equal(planSessionNameForRemote({ trackingName: '  ', selectionId: 'NAME M31' }), 'M31')
  assert.equal(planSessionNameForRemote({ trackingName: null, selectionId: null }), '')
  assert.equal(planSessionNameForRemote({}), '')
})
