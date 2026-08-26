import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VARIABLE_STAR_TARGET_ADU_DEFAULT,
  VARIABLE_STAR_TARGET_ADU_LARGE,
  VARIABLE_STAR_TARGET_ADU_MEDIUM,
  VARIABLE_STAR_TARGET_ADU_MIN,
  VARIABLE_STAR_TARGET_ADU_SMALL,
  variableStarAmplitudeMag,
  variableStarTargetAduFromAmplitude,
} from './variable-star-target-adu'

test('variableStarAmplitudeMag uses abs(min-max)', () => {
  assert.equal(variableStarAmplitudeMag(10.5, 9.5), 1)
  assert.equal(variableStarAmplitudeMag(9.5, 10.5), 1)
  assert.equal(variableStarAmplitudeMag(null, 9), null)
  assert.equal(variableStarAmplitudeMag(10, undefined), null)
})

test('variableStarTargetAduFromAmplitude tiers with floor 0.4', () => {
  assert.equal(variableStarTargetAduFromAmplitude(null), VARIABLE_STAR_TARGET_ADU_DEFAULT)
  assert.equal(variableStarTargetAduFromAmplitude(0.2), VARIABLE_STAR_TARGET_ADU_SMALL)
  assert.equal(variableStarTargetAduFromAmplitude(0.39), VARIABLE_STAR_TARGET_ADU_SMALL)
  assert.equal(variableStarTargetAduFromAmplitude(0.4), VARIABLE_STAR_TARGET_ADU_MEDIUM)
  assert.equal(variableStarTargetAduFromAmplitude(0.79), VARIABLE_STAR_TARGET_ADU_MEDIUM)
  assert.equal(variableStarTargetAduFromAmplitude(0.8), VARIABLE_STAR_TARGET_ADU_LARGE)
  assert.equal(variableStarTargetAduFromAmplitude(2.5), VARIABLE_STAR_TARGET_ADU_LARGE)
  assert.equal(VARIABLE_STAR_TARGET_ADU_LARGE, VARIABLE_STAR_TARGET_ADU_MIN)
  assert.ok(variableStarTargetAduFromAmplitude(5) >= VARIABLE_STAR_TARGET_ADU_MIN)
})
