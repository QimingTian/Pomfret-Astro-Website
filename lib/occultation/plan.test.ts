import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OCCULTATION_EXPOSURE_SEC,
  OCCULTATION_FILTER,
  OCCULTATION_LEAD_SEC,
  OCCULTATION_POST_PAD_SEC,
  OCCULTATION_PREPARE_SEC,
  occultationExposurePlan,
  occultationSubExposureSeconds,
} from './plan'

test('occultation plan starts 22 minutes early and images through one minute after', () => {
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, 10)
  assert.equal(plan.plannedStartMs, eventMs - OCCULTATION_LEAD_SEC * 1000)
  assert.equal(plan.eventFinishMs, eventMs + OCCULTATION_POST_PAD_SEC * 1000)
  const imagingSec = OCCULTATION_LEAD_SEC - OCCULTATION_PREPARE_SEC + OCCULTATION_POST_PAD_SEC
  assert.equal(plan.exposureCount, imagingSec / OCCULTATION_EXPOSURE_SEC)
  assert.equal(plan.estimatedDurationSeconds, OCCULTATION_LEAD_SEC + OCCULTATION_POST_PAD_SEC)
  assert.equal(OCCULTATION_FILTER, 'L')
  assert.equal(OCCULTATION_EXPOSURE_SEC, 1)
})

test('sub exposure follows star brightness and stays inside the cadence bounds', () => {
  assert.equal(occultationSubExposureSeconds(null), 1)
  assert.equal(occultationSubExposureSeconds(12), 1)
  assert.equal(occultationSubExposureSeconds(11), 0.4)
  assert.equal(occultationSubExposureSeconds(8), 0.2)
  assert.equal(occultationSubExposureSeconds(14), 1)
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, null, 0.4)
  const imagingSec = OCCULTATION_LEAD_SEC - OCCULTATION_PREPARE_SEC + OCCULTATION_POST_PAD_SEC
  assert.equal(plan.exposureSeconds, 0.4)
  assert.equal(plan.exposureCount, Math.ceil(imagingSec / 0.4))
})

test('a blink longer than two minutes extends the minute after the event', () => {
  const eventMs = Date.parse('2026-10-08T03:00:00.000Z')
  const plan = occultationExposurePlan(eventMs, 180)
  assert.equal(plan.eventFinishMs, eventMs + 90 * 1000)
  assert.equal(plan.estimatedDurationSeconds, OCCULTATION_LEAD_SEC + 90)
})
