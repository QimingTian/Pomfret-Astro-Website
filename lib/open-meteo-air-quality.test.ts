import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatUsAqiLabel, usAqiCategory, usAqiIsRed } from '@/lib/open-meteo-air-quality'

test('usAqiCategory follows EPA bands', () => {
  assert.equal(usAqiCategory(42), 'Good')
  assert.equal(usAqiCategory(92), 'Moderate')
  assert.equal(usAqiCategory(120), 'Unhealthy for Sensitive Groups')
  assert.equal(usAqiCategory(180), 'Unhealthy')
})

test('formatUsAqiLabel pairs category and value', () => {
  assert.equal(formatUsAqiLabel(92), 'Moderate (92)')
  assert.equal(formatUsAqiLabel(null), '—')
})

test('usAqiIsRed above 100', () => {
  assert.equal(usAqiIsRed(100), false)
  assert.equal(usAqiIsRed(101), true)
})
