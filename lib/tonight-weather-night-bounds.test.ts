import assert from 'node:assert/strict'
import test from 'node:test'
import { pickOpenMeteoImagingNightBounds } from '@/lib/tonight-weather-gate'

/** Jul 12 dusk → Jul 13 dawn (unix sec, illustrative). */
const SUNSET_JUL12 = 1_783_890_000
const SUNRISE_JUL13 = 1_783_914_000
const SUNSET_JUL13 = 1_783_976_400
const SUNRISE_JUL14 = 1_784_000_400

const sunsets = [SUNSET_JUL12, SUNSET_JUL13]
const sunrises = [SUNRISE_JUL13 - 86_400, SUNRISE_JUL13, SUNRISE_JUL14]

test('pickOpenMeteoImagingNightBounds keeps previous evening after local midnight', () => {
  // 00:47 local on Jul 13 — still inside Jul 12 evening → Jul 13 morning night.
  const afterMidnightMs = (SUNSET_JUL12 + SUNRISE_JUL13) / 2 * 1000
  const night = pickOpenMeteoImagingNightBounds(sunsets, sunrises, afterMidnightMs)
  assert.ok(night)
  assert.equal(night!.sunsetSec, SUNSET_JUL12)
  assert.equal(night!.sunriseSec, SUNRISE_JUL13)
})

test('pickOpenMeteoImagingNightBounds does not jump to next evening while current night is open', () => {
  const afterMidnightMs = (SUNSET_JUL12 + SUNRISE_JUL13) / 2 * 1000
  const night = pickOpenMeteoImagingNightBounds(sunsets, sunrises, afterMidnightMs)
  assert.ok(night)
  assert.notEqual(night!.sunsetSec, SUNSET_JUL13)
})

test('pickOpenMeteoImagingNightBounds picks upcoming dusk before night starts', () => {
  const afternoonMs = (SUNSET_JUL12 - 3 * 3600) * 1000
  const night = pickOpenMeteoImagingNightBounds(sunsets, sunrises, afternoonMs)
  assert.ok(night)
  assert.equal(night!.sunsetSec, SUNSET_JUL12)
  assert.equal(night!.sunriseSec, SUNRISE_JUL13)
})

test('pickOpenMeteoImagingNightBounds moves to next night after dawn', () => {
  const afterDawnMs = (SUNRISE_JUL13 + 3600) * 1000
  const night = pickOpenMeteoImagingNightBounds(sunsets, sunrises, afterDawnMs)
  assert.ok(night)
  assert.equal(night!.sunsetSec, SUNSET_JUL13)
  assert.equal(night!.sunriseSec, SUNRISE_JUL14)
})
