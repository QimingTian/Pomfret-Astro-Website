import assert from 'node:assert/strict'
import test from 'node:test'

import { isObservatoryNight, observatoryPollIntervalMs } from './observatory-poll-schedule'

test('observatoryPollIntervalMs is much slower by day than at night', () => {
  const day = new Date('2026-06-15T18:00:00.000Z')
  const night = new Date('2026-06-16T02:00:00.000Z')
  assert.equal(isObservatoryNight(day), false)
  assert.equal(isObservatoryNight(night), true)
  assert.ok(observatoryPollIntervalMs('site', {}, day) > observatoryPollIntervalMs('site', {}, night))
  assert.equal(observatoryPollIntervalMs('site', {}, night), 45_000)
  assert.equal(observatoryPollIntervalMs('site', { imagingActive: true }, night), 10_000)
  assert.equal(observatoryPollIntervalMs('queue', {}, night), 45_000)
  assert.equal(observatoryPollIntervalMs('queue', { imagingActive: true }, night), 10_000)
  assert.ok(observatoryPollIntervalMs('progress', { imagingActive: true }, night) <= 2_500)
})

test('hidden tabs poll less often', () => {
  const night = new Date('2026-06-16T02:00:00.000Z')
  const visible = observatoryPollIntervalMs('mount', {}, night)
  const hidden = observatoryPollIntervalMs('mount', { pageHidden: true }, night)
  assert.ok(hidden > visible)
})
