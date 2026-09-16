import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_HOLD_START_MARGIN_MS,
  nextProjectReservationStartMs,
  projectAltitudeHoldIntervals,
  remainingFiltersMoonBlockedTonight,
  sessionFitsBeforeProjectReservation,
} from './altitude-hold'
import { plannerFreeIntervalsBehindInProgressProject } from './planner'
import { tonightDurationSecondsFromPlans, type ImagingProject, type ProjectNight } from './store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

test('plannerFreeIntervalsBehindInProgressProject removes active target >=30° windows', () => {
  const now = new Date('2026-05-17T22:00:00.000Z')
  const window = getTonightSchedulingWindow(now)
  const free = [
    {
      startMs: window.nauticalDuskUtc.getTime(),
      endMs: window.nauticalDawnUtc.getTime(),
    },
  ]
  const active: ImagingProject = {
    id: 'proj-a',
    projectMode: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'in_progress',
    target: 'High Early',
    raHours: 12.7,
    decDeg: 12,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'L', exposureSeconds: 300, count: 10 }],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
    nights: [],
    onBoard: true,
  }
  const hold = projectAltitudeHoldIntervals(active, now)
  const successorFree = plannerFreeIntervalsBehindInProgressProject(active, free, '2026-05-17', now)
  const holdMs = hold.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  const freeMs = free.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  const successorMs = successorFree.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0)
  assert.ok(holdMs > 0, 'active target should have some >=30° time tonight')
  assert.ok(successorMs < freeMs, 'successor free time should be smaller than full night')
  assert.ok(successorMs <= freeMs - holdMs + 60_000, 'successor free should roughly exclude hold windows')
})

test('altitude hold stays when a remaining filter can still clear moon tonight', () => {
  const now = new Date('2026-05-31T20:00:00.000Z')
  const project = {
    raHours: 17.23,
    decDeg: 50,
    remainingByFilter: [{ filterName: 'H', exposureSeconds: 300, countRemaining: 10 }],
  }
  assert.equal(remainingFiltersMoonBlockedTonight(project, now), false)
  assert.ok(projectAltitudeHoldIntervals(project, now).length > 0)
})

const TRIM_NOW = new Date('2026-05-17T22:00:00.000Z')
const TRIM_RA_HOURS = 12.7
const TRIM_DEC_DEG = 12
const TONIGHT_PLANS = [{ filterName: 'L', exposureSeconds: 300, count: 10 }]

function holdFixture(overrides: Partial<ImagingProject>): ImagingProject {
  return {
    id: 'proj-trim',
    projectMode: true,
    createdAt: TRIM_NOW.toISOString(),
    updatedAt: TRIM_NOW.toISOString(),
    status: 'in_progress',
    target: 'Trim Target',
    raHours: TRIM_RA_HOURS,
    decDeg: TRIM_DEC_DEG,
    outputMode: 'raw_zip',
    filterPlansTotal: [{ filterName: 'L', exposureSeconds: 300, count: 10 }],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
    nights: [],
    onBoard: true,
    ...overrides,
  }
}

/** A sub-session starting at the first reserved instant, sized to `count` L frames. */
function tonightSub(status: ProjectNight['status'], count = 10): ProjectNight {
  const holdStartMs = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)[0]!.startMs
  return {
    id: 'proj-trim::night-1',
    nightKey: getTonightScheduleStrip(TRIM_NOW).nightKey,
    nightIndex: 1,
    status,
    plannedStartIso: new Date(holdStartMs).toISOString(),
    filterPlansTonight: [{ filterName: 'L', exposureSeconds: 300, count }],
    ninaSequenceJson: '{"mock":true}',
  }
}

function totalMs(intervals: Array<{ startMs: number; endMs: number }>): number {
  return intervals.reduce((sum, interval) => sum + (interval.endMs - interval.startMs), 0)
}

test('altitude hold is trimmed to the last sub-session when tonight finishes the project', () => {
  const fullHold = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)
  const sub = tonightSub('scheduled')
  const subEndMs =
    Date.parse(sub.plannedStartIso!) +
    tonightDurationSecondsFromPlans(sub.filterPlansTonight, {
      startMs: Date.parse(sub.plannedStartIso!),
      raHours: TRIM_RA_HOURS,
    }) *
      1000

  const trimmed = projectAltitudeHoldIntervals(holdFixture({ nights: [sub] }), TRIM_NOW)
  assert.ok(trimmed.length > 0, 'reservation should still cover the sub-session itself')
  assert.equal(Math.max(...trimmed.map((i) => i.endMs)), subEndMs)
  assert.ok(totalMs(trimmed) < totalMs(fullHold), 'trimmed reservation must free up later time')
})

test('altitude hold keeps the full window when tonight does not finish the project', () => {
  const fullHold = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)
  const carryOver = holdFixture({
    nights: [tonightSub('scheduled')],
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 40 }],
  })
  assert.deepEqual(projectAltitudeHoldIntervals(carryOver, TRIM_NOW), fullHold)
})

test('altitude hold stays trimmed once the final sub-session is in progress', () => {
  const scheduled = projectAltitudeHoldIntervals(
    holdFixture({ nights: [tonightSub('scheduled')] }),
    TRIM_NOW
  )
  const running = projectAltitudeHoldIntervals(
    holdFixture({ nights: [tonightSub('in_progress')] }),
    TRIM_NOW
  )
  assert.deepEqual(running, scheduled)
})

test('altitude hold returns to the full window after the final sub-session fails', () => {
  const fullHold = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)
  const afterFailure = holdFixture({ nights: [tonightSub('failed')] })
  assert.deepEqual(projectAltitudeHoldIntervals(afterFailure, TRIM_NOW), fullHold)
})

test('mosaic altitude hold trims on total panel frames, not the active panel', () => {
  const fullHold = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)
  const panels = [
    { id: 1, raHours: TRIM_RA_HOURS, decDeg: TRIM_DEC_DEG, positionAngleDeg: 0, name: 'Panel 1' },
    { id: 2, raHours: TRIM_RA_HOURS, decDeg: TRIM_DEC_DEG, positionAngleDeg: 0, name: 'Panel 2' },
  ]
  const twoPanelsLeft = holdFixture({
    nights: [tonightSub('scheduled')],
    mosaicMode: true,
    mosaicPanels: panels,
    mosaicRemainingByPanel: [
      [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
      [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
    ],
  })
  assert.deepEqual(
    projectAltitudeHoldIntervals(twoPanelsLeft, TRIM_NOW),
    fullHold,
    'panel 2 still owes frames, so the rest of the window stays reserved'
  )

  const lastPanel = holdFixture({
    nights: [tonightSub('scheduled')],
    mosaicMode: true,
    mosaicPanels: panels,
    mosaicRemainingByPanel: [
      [{ filterName: 'L', exposureSeconds: 300, countRemaining: 0 }],
      [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
    ],
  })
  assert.ok(
    totalMs(projectAltitudeHoldIntervals(lastPanel, TRIM_NOW)) < totalMs(fullHold),
    'tonight covers the last panel frames, so the reservation ends with it'
  )
})

test('mosaic altitude hold is never trimmed when per-panel progress is unknown', () => {
  const fullHold = projectAltitudeHoldIntervals(holdFixture({}), TRIM_NOW)
  const legacyMosaic = holdFixture({
    nights: [tonightSub('scheduled')],
    mosaicMode: true,
    mosaicPanels: [
      { id: 1, raHours: TRIM_RA_HOURS, decDeg: TRIM_DEC_DEG, positionAngleDeg: 0, name: 'Panel 1' },
      { id: 2, raHours: TRIM_RA_HOURS, decDeg: TRIM_DEC_DEG, positionAngleDeg: 0, name: 'Panel 2' },
    ],
  })
  assert.deepEqual(projectAltitudeHoldIntervals(legacyMosaic, TRIM_NOW), fullHold)
})

test('reservation guard needs the session to finish a full margin before the hold opens', () => {
  const nowMs = Date.parse('2026-05-17T22:00:00.000Z')
  const intervals = [
    { startMs: nowMs - 3600_000, endMs: nowMs - 1800_000 },
    { startMs: nowMs + 3600_000, endMs: nowMs + 4 * 3600_000 },
    { startMs: nowMs + 6 * 3600_000, endMs: nowMs + 7 * 3600_000 },
  ]
  const reservedStartMs = nextProjectReservationStartMs(intervals, nowMs)
  assert.equal(reservedStartMs, nowMs + 3600_000)

  const fittingSeconds = (3600_000 - PROJECT_HOLD_START_MARGIN_MS) / 1000
  assert.equal(
    sessionFitsBeforeProjectReservation({
      nowMs,
      estimatedDurationSeconds: fittingSeconds,
      reservedStartMs,
    }),
    true
  )
  assert.equal(
    sessionFitsBeforeProjectReservation({
      nowMs,
      estimatedDurationSeconds: fittingSeconds + 60,
      reservedStartMs,
    }),
    false,
    'a session that eats into the margin must wait'
  )
  assert.equal(
    sessionFitsBeforeProjectReservation({
      nowMs,
      estimatedDurationSeconds: 8 * 3600,
      reservedStartMs: null,
    }),
    true,
    'no reservation ahead means no guard'
  )
})

test('nextProjectReservationStartMs ignores reservations already under way', () => {
  const nowMs = Date.parse('2026-05-17T22:00:00.000Z')
  assert.equal(
    nextProjectReservationStartMs([{ startMs: nowMs - 60_000, endMs: nowMs + 3600_000 }], nowMs),
    null
  )
})

test('altitude hold is released when every remaining filter is moon-blocked for the rest of tonight', () => {
  const now = new Date('2026-06-01T04:00:00.000Z')
  const project = {
    raHours: 17.23,
    decDeg: 50,
    remainingByFilter: [{ filterName: 'L', exposureSeconds: 300, countRemaining: 10 }],
  }
  assert.equal(remainingFiltersMoonBlockedTonight(project, now), true)
  assert.deepEqual(projectAltitudeHoldIntervals(project, now), [])
})
