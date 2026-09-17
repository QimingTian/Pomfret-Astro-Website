import assert from 'node:assert/strict'
import test from 'node:test'
import { planTonightSubSessions } from './planner'
import type { ImagingProject } from './store'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

/**
 * The night of 2026-09-16 at Pomfret: M33 crosses 30° around 9:40 PM ET and the forecast held a
 * cloudy gap from midnight to 2 AM. Sizing a block against the whole night and shrinking it until
 * it fit anywhere produced one 40-frame run at 1:13 AM straddling the tail of that gap, and the
 * forward cursor then wrote off the clear evening entirely.
 */
function m33ShoProject(): ImagingProject {
  return {
    id: 'proj-m33-sho',
    projectMode: true,
    createdAt: '2026-09-16T14:00:00.000Z',
    updatedAt: '2026-09-16T14:00:00.000Z',
    status: 'pending',
    target: 'M33 SHO Project',
    raHours: 1.5648,
    decDeg: 30.66,
    outputMode: 'raw_zip',
    filterPlansTotal: [
      { filterName: 'S', exposureSeconds: 300, count: 100 },
      { filterName: 'H', exposureSeconds: 300, count: 100 },
      { filterName: 'O', exposureSeconds: 300, count: 100 },
    ],
    remainingByFilter: [
      { filterName: 'S', exposureSeconds: 300, countRemaining: 100 },
      { filterName: 'H', exposureSeconds: 300, countRemaining: 100 },
      { filterName: 'O', exposureSeconds: 300, countRemaining: 100 },
    ],
    nights: [],
    onBoard: false,
  }
}

const NOON_ET = new Date('2026-09-16T16:00:00.000Z')

function tonight() {
  const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(NOON_ET)
  return { windowStart: nauticalDuskUtc.getTime(), windowEnd: nauticalDawnUtc.getTime() }
}

function totalFrames(plans: Array<{ filterPlansTonight: Array<{ count: number }> }>): number {
  return plans.reduce((sum, p) => sum + p.filterPlansTonight.reduce((s, f) => s + f.count, 0), 0)
}

test('planTonightSubSessions uses a clear evening the big late block would have skipped', () => {
  const { windowStart, windowEnd } = tonight()
  const gapStart = Date.parse('2026-09-17T04:00:00.000Z') // midnight ET
  const gapEnd = Date.parse('2026-09-17T06:00:00.000Z') // 2 AM ET
  const weather = [
    { startMs: windowStart, endMs: gapStart },
    { startMs: gapEnd, endMs: windowEnd },
  ]
  const free = [{ startMs: windowStart, endMs: windowEnd }]

  const plans = planTonightSubSessions(m33ShoProject(), free, weather, NOON_ET)

  assert.ok(plans.length >= 2, `expected the evening to be used too, got ${plans.length} sub(s)`)
  const first = plans[0]!
  assert.ok(
    Date.parse(first.plannedEndIso) <= gapStart,
    `first session must fit inside the clear evening, ends ${first.plannedEndIso}`
  )
  const last = plans[plans.length - 1]!
  assert.ok(
    Date.parse(last.plannedStartIso) >= gapStart,
    'the late block must still be scheduled after the evening one'
  )
  assert.ok(
    totalFrames(plans) > 40,
    `the old single-block plan captured 40 frames; got ${totalFrames(plans)}`
  )
})

test('planTonightSubSessions still plans one continuous run when the whole night is clear', () => {
  const { windowStart, windowEnd } = tonight()
  const weather = [{ startMs: windowStart, endMs: windowEnd }]
  const free = [{ startMs: windowStart, endMs: windowEnd }]

  const plans = planTonightSubSessions(m33ShoProject(), free, weather, NOON_ET)

  assert.equal(plans.length, 1, 'a clear night needs no extra session')
  assert.ok(totalFrames(plans) > 60, `expected the night packed full, got ${totalFrames(plans)}`)
})

test('planTonightSubSessions leaves a clear spell alone when it cannot earn its overhead', () => {
  const { windowStart, windowEnd } = tonight()
  // 50 minutes of clear sky above 30°: room for a single 5-minute frame after 40 min of overhead.
  const spellStart = Date.parse('2026-09-17T01:40:00.000Z')
  const weather = [
    { startMs: spellStart, endMs: spellStart + 50 * 60_000 },
    { startMs: Date.parse('2026-09-17T06:00:00.000Z'), endMs: windowEnd },
  ]
  const free = [{ startMs: windowStart, endMs: windowEnd }]

  const plans = planTonightSubSessions(m33ShoProject(), free, weather, NOON_ET)

  assert.equal(plans.length, 1, 'a 50-minute spell is not worth a whole session for one frame')
  assert.ok(
    Date.parse(plans[0]!.plannedStartIso) >= Date.parse('2026-09-17T05:00:00.000Z'),
    `expected the single run in the long clear spell, got ${plans[0]!.plannedStartIso}`
  )
})
