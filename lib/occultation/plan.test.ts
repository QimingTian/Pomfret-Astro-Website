import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OCCULTATION_EXPOSURE_SEC,
  OCCULTATION_FILTER,
  OCCULTATION_LEAD_SEC,
  OCCULTATION_POST_PAD_SEC,
  occultationExposurePlan,
  occultationSubExposureSeconds,
} from './plan'

test('occultation plan starts 30 minutes early and counts 1s frames through the end', () => {
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, 10)
  assert.equal(plan.plannedStartMs, eventMs - OCCULTATION_LEAD_SEC * 1000)
  assert.equal(plan.eventFinishMs, eventMs + 5 * 1000 + OCCULTATION_POST_PAD_SEC * 1000)
  const spanSec = (plan.eventFinishMs - plan.plannedStartMs) / 1000
  assert.equal(plan.exposureCount, Math.ceil(spanSec / OCCULTATION_EXPOSURE_SEC))
  assert.equal(plan.estimatedDurationSeconds, plan.exposureCount)
  assert.equal(OCCULTATION_FILTER, 'L')
  assert.equal(OCCULTATION_EXPOSURE_SEC, 1)
})

test('sub exposure follows star brightness and stays inside the cadence bounds', () => {
  assert.equal(occultationSubExposureSeconds(null), 1)
  assert.equal(occultationSubExposureSeconds(12), 1)
  assert.equal(occultationSubExposureSeconds(11), 0.4)
  assert.equal(occultationSubExposureSeconds(8), 0.2)
  assert.equal(occultationSubExposureSeconds(14), 2)
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, null, 0.4)
  assert.equal(plan.exposureSeconds, 0.4)
  assert.equal(plan.exposureCount, Math.ceil((OCCULTATION_LEAD_SEC + OCCULTATION_POST_PAD_SEC) / 0.4))
})

test('unknown event duration still pads 60 seconds after the instant', () => {
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, null)
  assert.equal(plan.eventFinishMs, eventMs + OCCULTATION_POST_PAD_SEC * 1000)
  assert.equal(plan.exposureCount, OCCULTATION_LEAD_SEC + OCCULTATION_POST_PAD_SEC)
})
