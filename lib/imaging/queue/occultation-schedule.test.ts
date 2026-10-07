import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { occultationExposurePlan } from '@/lib/occultation/plan'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import type { TimeInterval } from '@/lib/tonight-weather-gate'

import { computeScheduleInsight, type SchedulePendingRow } from './schedule-insight'

const NOW_MS = Date.parse('2026-05-18T02:00:00.000Z')

function withMockedNow<T>(fn: () => T): T {
  mock.timers.enable({ apis: ['Date'], now: NOW_MS })
  try {
    return fn()
  } finally {
    mock.timers.reset()
  }
}

function openWeatherTonight(): TimeInterval[] {
  const window = getTonightSchedulingWindow(new Date(NOW_MS))
  return [{ startMs: window.nauticalDuskUtc.getTime(), endMs: window.nauticalDawnUtc.getTime() }]
}

test('occultation is scheduled only at event minus 22 minutes', () => {
  withMockedNow(() => {
    const eventMs = NOW_MS + 2 * 60 * 60 * 1000
    const plan = occultationExposurePlan(eventMs, 10)
    const row: SchedulePendingRow = {
      id: 'occ',
      createdAt: new Date(NOW_MS - 60_000).toISOString(),
      target: '(704) Interamnia',
      exposureSeconds: 1,
      count: plan.exposureCount,
      estimatedDurationSeconds: plan.estimatedDurationSeconds,
      sequenceTemplate: 'asteroid_occultation',
      occultationEventIso: new Date(eventMs).toISOString(),
      occultationDurationSeconds: 10,
      status: 'pending',
    }
    const insight = computeScheduleInsight([row], 'occ', openWeatherTonight())
    assert.equal(insight.status, 'scheduled', insight.reasons.join(' | '))
    assert.equal(insight.plannedStartIso, new Date(plan.plannedStartMs).toISOString())
  })
})

test('a flexible session fills around the occultation instead of taking its window', () => {
  withMockedNow(() => {
    const eventMs = NOW_MS + 2 * 60 * 60 * 1000
    const plan = occultationExposurePlan(eventMs, 8)
    const occultation: SchedulePendingRow = {
      id: 'occ',
      createdAt: new Date(NOW_MS - 60_000).toISOString(),
      target: 'Occultation',
      exposureSeconds: 1,
      count: plan.exposureCount,
      estimatedDurationSeconds: plan.estimatedDurationSeconds,
      sequenceTemplate: 'asteroid_occultation',
      occultationEventIso: new Date(eventMs).toISOString(),
      occultationDurationSeconds: 8,
      status: 'pending',
    }
    const dso: SchedulePendingRow = {
      id: 'dso',
      createdAt: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString(),
      target: 'M31',
      exposureSeconds: 60,
      count: 10,
      estimatedDurationSeconds: 3 * 60 * 60,
      sequenceTemplate: 'dso',
      status: 'pending',
    }
    const dsoInsight = computeScheduleInsight([dso, occultation], 'dso', openWeatherTonight())
    const occInsight = computeScheduleInsight([dso, occultation], 'occ', openWeatherTonight())
    assert.equal(occInsight.status, 'scheduled', occInsight.reasons.join(' | '))
    assert.equal(dsoInsight.status, 'scheduled', dsoInsight.reasons.join(' | '))
    const dsoStart = Date.parse(dsoInsight.plannedStartIso!)
    const dsoEnd = dsoStart + 3 * 60 * 60 * 1000
    const occStart = Date.parse(occInsight.plannedStartIso!)
    const occEnd = occStart + plan.estimatedDurationSeconds * 1000
    assert.ok(dsoEnd <= occStart || dsoStart >= occEnd, `${dsoInsight.plannedStartIso} overlaps ${occInsight.plannedStartIso}`)
  })
})

test('occultation does not slide when the fixed window has no weather', () => {
  withMockedNow(() => {
    const eventMs = NOW_MS + 2 * 60 * 60 * 1000
    const plan = occultationExposurePlan(eventMs, 10)
    const row: SchedulePendingRow = {
      id: 'occ',
      createdAt: new Date(NOW_MS - 60_000).toISOString(),
      target: 'Occultation',
      exposureSeconds: 1,
      count: plan.exposureCount,
      estimatedDurationSeconds: plan.estimatedDurationSeconds,
      sequenceTemplate: 'asteroid_occultation',
      occultationEventIso: new Date(eventMs).toISOString(),
      occultationDurationSeconds: 10,
      status: 'pending',
    }
    const after = plan.plannedStartMs + plan.estimatedDurationSeconds * 1000 + 60_000
    const window = getTonightSchedulingWindow(new Date(NOW_MS))
    const insight = computeScheduleInsight([row], 'occ', [
      { startMs: after, endMs: window.nauticalDawnUtc.getTime() },
    ])
    assert.equal(insight.status, 'unscheduled')
    assert.equal(insight.plannedStartIso, null)
    assert.match(insight.reasons.join(' '), /fixed occultation window/i)
  })
})
