import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatDecDegDms,
  formatRaDecPair,
  formatRaDecTargetLabel,
  formatRaHoursHms,
} from '@/lib/format-radec'

test('formatRaHoursHms uses integer HMS with no decimals', () => {
  assert.equal(formatRaHoursHms(12.582222222), '12h 34m 56s')
  assert.equal(formatRaHoursHms(0), '00h 00m 00s')
  assert.doesNotMatch(formatRaHoursHms(18.5), /\./)
})

test('formatDecDegDms uses integer DMS with sign', () => {
  assert.equal(formatDecDegDms(41.208333333), '+41° 12′ 30″')
  assert.equal(formatDecDegDms(-5.5), '−05° 30′ 00″')
  assert.doesNotMatch(formatDecDegDms(12.345), /\./)
})

test('formatRaDecPair joins with slash', () => {
  assert.equal(formatRaDecPair(1, 2), '01h 00m 00s / +02° 00′ 00″')
})

test('formatRaDecTargetLabel for queue fallback name', () => {
  assert.match(formatRaDecTargetLabel(5.5, -10), /^RA 05h 30m 00s · Dec −10°/)
})
