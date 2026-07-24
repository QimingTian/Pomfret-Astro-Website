import assert from 'node:assert/strict'
import test from 'node:test'

import {
  maximumAltitudeDegAtMeridian,
  minDecDegForMinAltitudeAtMeridian,
  OBS_LAT_DEG,
  pomfretTargetObservabilityError,
  targetNeverRisesAtSite,
  targetObservableFromSite,
} from '@/lib/target-altitude'

test('Pomfret min dec for 30° meridian altitude matches lat - 60°', () => {
  assert.ok(Math.abs(minDecDegForMinAltitudeAtMeridian() - (OBS_LAT_DEG - 60)) < 0.01)
})

test('targetNeverRisesAtSite rejects far-southern declinations', () => {
  assert.equal(targetNeverRisesAtSite(-60), true)
  assert.equal(targetNeverRisesAtSite(-49), true)
  assert.equal(targetNeverRisesAtSite(-48), false)
})

test('targetObservableFromSite allows northern targets and low-but-valid southern dec', () => {
  assert.equal(targetObservableFromSite(45), true)
  assert.equal(targetObservableFromSite(-10), true)
  assert.equal(targetObservableFromSite(-19), false)
})

test('pomfretTargetObservabilityError distinguishes never rises vs too low', () => {
  assert.match(pomfretTargetObservabilityError(-55)!, /never rises/i)
  assert.match(pomfretTargetObservabilityError(-30)!, /only reaches/i)
  assert.equal(pomfretTargetObservabilityError(10), null)
})

test('maximumAltitudeDegAtMeridian matches 90 - |lat - dec|', () => {
  assert.ok(Math.abs(maximumAltitudeDegAtMeridian(0) - (90 - OBS_LAT_DEG)) < 0.02)
})
