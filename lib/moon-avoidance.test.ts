import assert from 'node:assert/strict'
import test from 'node:test'
import {
  angularSeparationDeg,
  moonAltDeg,
  moonEquatorial,
  moonFilterOkAt,
  moonFilterSessionOk,
  normalizeFilterName,
  requiredMoonSeparationDeg,
  MOON_FILTER_DISTANCE_DEG,
} from './moon-avoidance'

const SYNODIC = 29.530588853
const FULL_MOON_AGE = SYNODIC / 2

test('Lorentzian peaks at full moon (required separation == filter distance)', () => {
  assert.ok(Math.abs(requiredMoonSeparationDeg('L', FULL_MOON_AGE) - MOON_FILTER_DISTANCE_DEG.L!) < 0.5)
  assert.ok(Math.abs(requiredMoonSeparationDeg('H', FULL_MOON_AGE) - MOON_FILTER_DISTANCE_DEG.H!) < 0.5)
})

test('Lorentzian relaxes away from full moon (new moon < quarter < full)', () => {
  const newMoon = requiredMoonSeparationDeg('L', 0)
  const quarter = requiredMoonSeparationDeg('L', 7)
  const full = requiredMoonSeparationDeg('L', FULL_MOON_AGE)
  assert.ok(newMoon < quarter, `new ${newMoon} should be < quarter ${quarter}`)
  assert.ok(quarter < full, `quarter ${quarter} should be < full ${full}`)
})

test('filter tiers ordered broadband > OIII > SII > Ha at full moon', () => {
  const l = requiredMoonSeparationDeg('L', FULL_MOON_AGE)
  const o = requiredMoonSeparationDeg('O', FULL_MOON_AGE)
  const s = requiredMoonSeparationDeg('S', FULL_MOON_AGE)
  const h = requiredMoonSeparationDeg('H', FULL_MOON_AGE)
  assert.ok(l > o && o > s && s > h, `expected L>O>S>H, got ${l},${o},${s},${h}`)
})

test('normalizeFilterName maps common aliases to tier keys', () => {
  assert.equal(normalizeFilterName('Ha'), 'H')
  assert.equal(normalizeFilterName('OIII'), 'O')
  assert.equal(normalizeFilterName('SII'), 'S')
  assert.equal(normalizeFilterName('Lum'), 'L')
  assert.equal(normalizeFilterName('Red'), 'R')
  assert.equal(normalizeFilterName('G'), 'G')
})

test('angularSeparationDeg handles known geometry', () => {
  assert.ok(Math.abs(angularSeparationDeg(5, 10, 5, 10)) < 1e-6)
  assert.ok(Math.abs(angularSeparationDeg(0, 0, 0, 90) - 90) < 1e-6)
  assert.ok(Math.abs(angularSeparationDeg(0, 0, 12, 0) - 180) < 1e-6)
})

test('moon below horizon → all filters allowed even at zero separation', () => {
  const moonDown = new Date('2026-05-31T10:00:00.000Z')
  assert.ok(moonAltDeg(moonDown) < 0, 'precondition: moon should be below horizon')
  const moon = moonEquatorial(moonDown)
  // Target sitting right on the moon — would always fail if the moon were up.
  assert.equal(moonFilterOkAt('L', moon.raHours, moon.decDeg, moonDown), true)
})

test('moon up near full blocks broadband but allows Ha for a mid-separation target', () => {
  // Night of 2026-05-31/06-01: moon up (~19°) and ~full near astronomical midnight.
  const startMs = Date.parse('2026-06-01T02:15:00.000Z')
  const endMs = startMs + 90 * 60_000
  const raHours = 17.23
  const decDeg = 50 // ~78° from the moon → inside broadband avoidance, outside Ha avoidance
  assert.equal(moonFilterSessionOk('L', raHours, decDeg, startMs, endMs), false)
  assert.equal(moonFilterSessionOk('H', raHours, decDeg, startMs, endMs), true)
})
