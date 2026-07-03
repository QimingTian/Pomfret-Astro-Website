import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTonightWeatherWindows,
  mergeAdjacentIntervals,
  planTonightFilterFrames,
  planTonightSubSessions,
  projectTonightScheduleInsight,
  shouldKeepExistingDeliverableTonight,
} from './planner'
import type { ImagingProject, ProjectNight } from './store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

function mockProject(): ImagingProject {
  return {
    id: 'proj-1',
    projectMode: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    target: 'Test Target',
    raHours: 12,
    decDeg: 45,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'Red', exposureSeconds: 300, count: 100 }],
    remainingByFilter: [{ filterName: 'Red', exposureSeconds: 300, countRemaining: 100 }],
    nights: [],
    onBoard: false,
  }
}

test('mergeAdjacentIntervals joins back-to-back hourly clear hours', () => {
  const t0 = Date.parse('2026-05-18T01:00:00.000Z')
  const merged = mergeAdjacentIntervals([
    { startMs: t0, endMs: t0 + 3600_000 },
    { startMs: t0 + 3600_000, endMs: t0 + 2 * 3600_000 },
    { startMs: t0 + 2 * 3600_000, endMs: t0 + 3 * 3600_000 },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]!.endMs - merged[0]!.startMs, 3 * 3600_000)
})

test('buildTonightWeatherWindows merges gaps separated by cloud', () => {
  const windowStart = Date.parse('2026-05-17T02:00:00.000Z')
  const windowEnd = Date.parse('2026-05-17T10:00:00.000Z')
  const weather = [
    { startMs: windowStart, endMs: windowStart + 2 * 3600_000 },
    { startMs: windowStart + 4 * 3600_000, endMs: windowEnd },
  ]
  const free = [{ startMs: windowStart, endMs: windowEnd }]
  const windows = buildTonightWeatherWindows(
    free,
    weather,
    windowStart,
    windowEnd,
    20 * 60_000
  )
  assert.equal(windows.length, 2)
})

function tonightSchedulingSpan(now: Date) {
  const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(now)
  return { windowStart: nauticalDuskUtc.getTime(), windowEnd: nauticalDawnUtc.getTime() }
}

test('planTonightSubSessions assigns increasing session indices', () => {
  const project = mockProject()
  const now = new Date('2026-05-17T20:00:00.000Z')
  const { windowStart, windowEnd } = tonightSchedulingSpan(now)
  const weather = [{ startMs: windowStart, endMs: windowEnd }]
  const free = [{ startMs: windowStart, endMs: windowEnd }]
  const plans = planTonightSubSessions(project, free, weather, now)
  for (let i = 1; i < plans.length; i++) {
    assert.ok(plans[i]!.nightIndex > plans[i - 1]!.nightIndex)
  }
})

test('planTonightSubSessions can start after predecessor when weather spans a short gap', () => {
  const project = mockProject()
  project.target = 'M101 Project'
  project.raHours = 12.7
  project.decDeg = 45
  project.filterPlansTotal = [{ filterName: 'L', exposureSeconds: 600, count: 10 }]
  project.remainingByFilter = [{ filterName: 'L', exposureSeconds: 600, countRemaining: 10 }]

  const markarianEnd = Date.parse('2026-05-19T05:36:45.946Z')
  const now = new Date('2026-05-19T01:52:43.000Z')
  const { windowStart, windowEnd } = tonightSchedulingSpan(now)
  // Clear weather continues through 1:36 AM; old spell splitting used a too-short 1:36–2:00 slice.
  const weather = [{ startMs: windowStart, endMs: Date.parse('2026-05-19T08:00:00.000Z') }]
  const free = [{ startMs: markarianEnd, endMs: windowEnd }]
  const plans = planTonightSubSessions(project, free, weather, now)
  assert.equal(plans.length, 1)
  const startMs = Date.parse(plans[0]!.plannedStartIso)
  assert.ok(
    startMs <= markarianEnd + 60_000,
    `expected start right after Markarian ends, got ${plans[0]!.plannedStartIso}`
  )
})

function moonBlockedRgbHaProject(): ImagingProject {
  // Target ~78° from a near-full moon that is up on the night of 2026-05-31/06-01:
  // broadband (R/G/B) fails moon avoidance, Ha passes.
  const p = mockProject()
  p.raHours = 17.23
  p.decDeg = 50
  p.filterPlansTotal = [
    { filterName: 'R', exposureSeconds: 120, count: 10 },
    { filterName: 'G', exposureSeconds: 120, count: 10 },
    { filterName: 'B', exposureSeconds: 120, count: 10 },
    { filterName: 'H', exposureSeconds: 120, count: 10 },
  ]
  p.remainingByFilter = p.filterPlansTotal.map((f) => ({
    filterName: f.filterName,
    exposureSeconds: f.exposureSeconds,
    countRemaining: f.count,
  }))
  return p
}

test('planTonightFilterFrames skips moon-blocked broadband and packs only Ha', () => {
  const project = moonBlockedRgbHaProject()
  const startMs = Date.parse('2026-06-01T02:15:00.000Z')
  const endMs = startMs + 3 * 3600_000
  const { filterPlansTonight } = planTonightFilterFrames(
    project,
    startMs,
    endMs,
    project.remainingByFilter
  )
  assert.deepEqual(
    filterPlansTonight.map((p) => p.filterName),
    ['H'],
    'only Ha should survive moon avoidance for this window'
  )
})

test('planTonightFilterFrames does not backfill leftover window with moon-blocked filters', () => {
  const project = moonBlockedRgbHaProject()
  const startMs = Date.parse('2026-06-01T02:15:00.000Z')
  // Window far longer than the Ha frames need; broadband must NOT fill the leftover time.
  const endMs = startMs + 8 * 3600_000
  const { filterPlansTonight } = planTonightFilterFrames(
    project,
    startMs,
    endMs,
    project.remainingByFilter
  )
  assert.deepEqual(filterPlansTonight.map((p) => p.filterName), ['H'])
  const haRow = filterPlansTonight.find((p) => p.filterName === 'H')!
  assert.equal(haRow.count, 10, 'all remaining Ha frames packed; RGB frames carry over')
})

test('planTonightSubSessions fills multiple clear spells and leftover time in a spell', () => {
  const project = mockProject()
  project.raHours = 12.7
  project.decDeg = 12
  project.filterPlansTotal = [
    { filterName: 'L', exposureSeconds: 300, count: 40 },
    { filterName: 'R', exposureSeconds: 300, count: 40 },
  ]
  project.remainingByFilter = [
    { filterName: 'L', exposureSeconds: 300, countRemaining: 40 },
    { filterName: 'R', exposureSeconds: 300, countRemaining: 40 },
  ]
  const now = new Date('2026-05-17T22:30:00.000Z')
  const { windowStart, windowEnd } = tonightSchedulingSpan(now)
  const weather = [
    { startMs: Date.parse('2026-05-17T23:00:00.000Z'), endMs: Date.parse('2026-05-18T04:00:00.000Z') },
    { startMs: Date.parse('2026-05-18T05:00:00.000Z'), endMs: Date.parse('2026-05-18T09:00:00.000Z') },
  ]
  const free = [{ startMs: windowStart, endMs: windowEnd }]
  const plans = planTonightSubSessions(project, free, weather, now)
  assert.ok(plans.length >= 2, `expected sessions in both clear spells, got ${plans.length}`)
  for (let i = 1; i < plans.length; i++) {
    const prevEnd =
      Date.parse(plans[i - 1]!.plannedStartIso) + plans[i - 1]!.durationSeconds * 1000
    const nextStart = Date.parse(plans[i]!.plannedStartIso)
    assert.ok(nextStart >= prevEnd - 1000)
  }
})

test('shouldKeepExistingDeliverableTonight drops scheduled sub when admin closed removes all weather windows', () => {
  const now = new Date('2026-05-30T22:00:00.000Z')
  const nightKey = getTonightScheduleStrip(now).nightKey
  const plannedStartIso = '2026-05-31T01:00:00.000Z'
  const scheduledNight: ProjectNight = {
    id: 'sub-3',
    nightIndex: 3,
    nightKey,
    status: 'scheduled',
    plannedStartIso,
    filterPlansTonight: [{ filterName: 'Red', exposureSeconds: 300, count: 4 }],
    ninaSequenceJson: '{"mock":true}',
  }
  const project: ImagingProject = {
    ...mockProject(),
    status: 'in_progress',
    nights: [scheduledNight],
    remainingByFilter: [{ filterName: 'Red', exposureSeconds: 300, countRemaining: 40 }],
  }
  const { windowStart, windowEnd } = tonightSchedulingSpan(now)
  const free = [{ startMs: windowStart, endMs: windowEnd }]
  const weatherBlocked: Array<{ startMs: number; endMs: number }> = []

  assert.equal(
    shouldKeepExistingDeliverableTonight(project, free, weatherBlocked, nightKey, now),
    false
  )
  const insight = projectTonightScheduleInsight(project, [], free, weatherBlocked, nightKey, now)
  assert.equal(insight.status, 'unscheduled')
  assert.equal(insight.plannedStartIso, null)
})

test('planTonightSubSessions places future subs after in_progress into later clear weather', () => {
  const now = new Date('2026-05-17T22:30:00.000Z')
  const nightKey = getTonightScheduleStrip(now).nightKey
  const { windowStart, windowEnd } = tonightSchedulingSpan(now)
  const session1Start = Date.parse('2026-05-17T23:00:00.000Z')
  const inProgressNight: ProjectNight = {
    id: 'sub-1',
    nightIndex: 1,
    nightKey,
    status: 'in_progress',
    plannedStartIso: new Date(session1Start).toISOString(),
    filterPlansTonight: [{ filterName: 'Red', exposureSeconds: 300, count: 5 }],
    ninaSequenceJson: '{"mock":true}',
  }
  const project: ImagingProject = {
    ...mockProject(),
    status: 'in_progress',
    remainingByFilter: [{ filterName: 'Red', exposureSeconds: 300, countRemaining: 15 }],
    nights: [inProgressNight],
  }
  const clearStart = Date.parse('2026-05-18T03:00:00.000Z')
  const weather = [{ startMs: clearStart, endMs: windowEnd }]
  const free = [{ startMs: session1Start + 4 * 3600_000, endMs: windowEnd }]
  const plans = planTonightSubSessions(project, free, weather, now)
  assert.ok(plans.length >= 1, 'expected at least one future sub-session')
  const startMs = Date.parse(plans[0]!.plannedStartIso)
  assert.ok(startMs >= clearStart, `expected start in clear weather, got ${plans[0]!.plannedStartIso}`)
  assert.equal(plans[0]!.nightIndex, 2)
  assert.ok(startMs >= windowStart)
})
