import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gemSpinDeltasDeg,
  hourAngleDeg,
  isPierWest,
  localSiderealTimeHours,
  normalizeSigned180,
} from './mount-gem-angles.ts'
import { currentAltitudeDeg } from './target-altitude.ts'

test('hourAngleDeg wraps to signed 180', () => {
  assert.equal(hourAngleDeg(0, 0), 0)
  assert.equal(hourAngleDeg(1, 0), -15)
  assert.equal(hourAngleDeg(0, 1), 15)
  assert.equal(normalizeSigned180(190), -170)
})

test('localSiderealTimeHours agrees with target-altitude HA for known pointing', () => {
  const now = new Date('2026-07-14T03:51:11.846Z')
  const raHours = 20.930565402705525
  const decDeg = 45.14492090190711
  const lst = localSiderealTimeHours(now)
  assert.ok(lst >= 0 && lst < 24)
  const haDeg = hourAngleDeg(raHours, lst)
  const altFromGem = currentAltitudeDeg(raHours, decDeg, now)
  assert.ok(Math.abs(altFromGem - 63.856) < 1.5, `alt ${altFromGem} ha ${haDeg}`)
})

test('gemSpinDeltasDeg rest at NCP is zero', () => {
  const d = gemSpinDeltasDeg({
    raHours: 5,
    decDeg: 90,
    siderealTimeHours: 5,
    sideOfPier: 'pierEast',
  })
  assert.equal(d.haDeg, 0)
  assert.equal(d.raDeltaDeg, 0)
  assert.equal(d.decDeltaDeg, 0)
  assert.equal(d.pierWest, false)
})

test('gemSpinDeltasDeg pier east uses HA-90 / Dec-90 (Blender ME clocks)', () => {
  const d = gemSpinDeltasDeg({
    raHours: 0,
    decDeg: 60,
    siderealTimeHours: 1,
    sideOfPier: 'pierEast',
  })
  assert.equal(d.haDeg, 15)
  assert.equal(d.raDeltaDeg, 15 - 90)
  assert.equal(d.decDeltaDeg, 60 - 90)
  assert.equal(d.pierWest, false)
})

test('gemSpinDeltasDeg pier west uses HA+90 / 90-Dec', () => {
  const d = gemSpinDeltasDeg({
    raHours: 0,
    decDeg: 60,
    siderealTimeHours: 1,
    sideOfPier: 'pierWest',
  })
  assert.equal(d.haDeg, 15)
  assert.equal(d.pierWest, true)
  assert.equal(d.raDeltaDeg, 15 + 90)
  assert.equal(d.decDeltaDeg, 90 - 60)
})

test('isPierWest respects explicit side and falls back', () => {
  assert.equal(isPierWest('pierWest', -20), true)
  assert.equal(isPierWest('pierEast', 100), false)
})

test('gemSpinDeltasDeg matches Blender NGC7000 check (pier east)', () => {
  // Fixed epoch used in Blender verification session (approx).
  const lst = localSiderealTimeHours(new Date('2026-07-14T05:30:00Z'))
  const raHours = 20 + 58 / 60 + 47 / 3600
  const decDeg = 44 + 31 / 60 + 40 / 3600
  const d = gemSpinDeltasDeg({
    raHours,
    decDeg,
    siderealTimeHours: lst,
    sideOfPier: 'pierEast',
  })
  const ha = hourAngleDeg(raHours, lst)
  assert.ok(Math.abs(d.raDeltaDeg - (ha - 90)) < 1e-6)
  assert.ok(Math.abs(d.decDeltaDeg - (decDeg - 90)) < 1e-6)
})
