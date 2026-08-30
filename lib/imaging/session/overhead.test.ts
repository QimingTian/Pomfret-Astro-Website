import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DSO_SESSION_OVERHEAD_SEC,
  DSO_MERIDIAN_FLIP_OVERHEAD_SEC,
  DSO_EXTRA_FILTER_OVERHEAD_SEC,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  VARIABLE_STAR_MERIDIAN_FLIP_OVERHEAD_SEC,
  distinctFiltersWithFrames,
  dsoSessionOverheadSeconds,
  dsoSessionDurationSeconds,
  sessionCrossesMeridian,
  variableStarSessionOverheadSeconds,
  variableStarSessionDurationSeconds,
  variableStarBlockHoursFromTotalSeconds,
} from './overhead'
import { hourAngleDeg, localSiderealTimeHours } from '@/lib/mount-gem-angles'

test('distinctFiltersWithFrames ignores zero-count rows', () => {
  assert.equal(
    distinctFiltersWithFrames([
      { filterName: 'O', exposureSeconds: 300, count: 10 },
      { filterName: 'S', exposureSeconds: 300, count: 0 },
      { filterName: 'H', exposureSeconds: 300, count: 5 },
    ]),
    2
  )
})

test('dsoSessionOverheadSeconds: one filter, no start → base only', () => {
  assert.equal(
    dsoSessionOverheadSeconds({
      filterPlans: [{ filterName: 'O', exposureSeconds: 300, count: 10 }],
    }),
    DSO_SESSION_OVERHEAD_SEC
  )
})

test('dsoSessionOverheadSeconds: three filters → base + 2×5 min', () => {
  assert.equal(
    dsoSessionOverheadSeconds({
      filterPlans: [
        { filterName: 'O', exposureSeconds: 300, count: 10 },
        { filterName: 'S', exposureSeconds: 300, count: 10 },
        { filterName: 'H', exposureSeconds: 300, count: 10 },
      ],
    }),
    DSO_SESSION_OVERHEAD_SEC + 2 * DSO_EXTRA_FILTER_OVERHEAD_SEC
  )
})

test('dsoSessionDurationSeconds adds imaging to overhead', () => {
  const plans = [{ filterName: 'O', exposureSeconds: 300, count: 2 }]
  assert.equal(
    dsoSessionDurationSeconds({ filterPlans: plans }),
    600 + DSO_SESSION_OVERHEAD_SEC
  )
})

test('sessionCrossesMeridian detects HA sign change across meridian', () => {
  // Find a moment when HA is near 0 and walk a long enough window.
  // Cygnus-ish RA ~20.5h: transit when LST ≈ RA.
  const raHours = 20.5
  let transitMs: number | null = null
  const t0 = Date.parse('2026-07-14T00:00:00.000Z')
  for (let t = t0; t < t0 + 24 * 3600_000; t += 10 * 60_000) {
    const ha = hourAngleDeg(raHours, localSiderealTimeHours(new Date(t)))
    if (Math.abs(ha) < 2) {
      transitMs = t
      break
    }
  }
  assert.ok(transitMs != null, 'expected to find a near-meridian sample')
  const startMs = transitMs! - 30 * 60_000
  const endMs = transitMs! + 30 * 60_000
  assert.equal(sessionCrossesMeridian(raHours, startMs, endMs), true)
  assert.equal(sessionCrossesMeridian(raHours, startMs, startMs + 5 * 60_000), false)
})

test('dsoSessionOverheadSeconds adds flip when provisional block crosses meridian', () => {
  const raHours = 20.5
  const t0 = Date.parse('2026-07-14T00:00:00.000Z')
  let transitMs: number | null = null
  for (let t = t0; t < t0 + 24 * 3600_000; t += 10 * 60_000) {
    const ha = hourAngleDeg(raHours, localSiderealTimeHours(new Date(t)))
    if (Math.abs(ha) < 2) {
      transitMs = t
      break
    }
  }
  assert.ok(transitMs != null)
  const startMs = transitMs! - 20 * 60_000
  const plans = [{ filterName: 'O', exposureSeconds: 300, count: 40 }] // 200 min imaging
  const overhead = dsoSessionOverheadSeconds({
    filterPlans: plans,
    raHours,
    startMs,
  })
  assert.equal(overhead, DSO_SESSION_OVERHEAD_SEC + DSO_MERIDIAN_FLIP_OVERHEAD_SEC)
})

test('variableStarSessionOverheadSeconds: no start → 30 min base only', () => {
  assert.equal(variableStarSessionOverheadSeconds(), VARIABLE_STAR_SESSION_OVERHEAD_SEC)
})

test('variableStarSessionDurationSeconds: 1 h block + base overhead', () => {
  assert.equal(
    variableStarSessionDurationSeconds({ blockHours: 1 }),
    3600 + VARIABLE_STAR_SESSION_OVERHEAD_SEC
  )
})

test('variableStarSessionOverheadSeconds adds flip when block crosses meridian', () => {
  const raHours = 20.5
  const t0 = Date.parse('2026-07-14T00:00:00.000Z')
  let transitMs: number | null = null
  for (let t = t0; t < t0 + 24 * 3600_000; t += 10 * 60_000) {
    const ha = hourAngleDeg(raHours, localSiderealTimeHours(new Date(t)))
    if (Math.abs(ha) < 2) {
      transitMs = t
      break
    }
  }
  assert.ok(transitMs != null)
  const startMs = transitMs! - 20 * 60_000
  const blockSec = 2 * 3600
  const overhead = variableStarSessionOverheadSeconds({ raHours, startMs, blockSeconds: blockSec })
  assert.equal(overhead, VARIABLE_STAR_SESSION_OVERHEAD_SEC + VARIABLE_STAR_MERIDIAN_FLIP_OVERHEAD_SEC)
})

test('variableStarBlockHoursFromTotalSeconds reverses client total with meridian flip', () => {
  const raHours = 20.5
  const t0 = Date.parse('2026-07-14T00:00:00.000Z')
  let transitMs: number | null = null
  for (let t = t0; t < t0 + 24 * 3600_000; t += 10 * 60_000) {
    const ha = hourAngleDeg(raHours, localSiderealTimeHours(new Date(t)))
    if (Math.abs(ha) < 2) {
      transitMs = t
      break
    }
  }
  assert.ok(transitMs != null)
  const startMs = transitMs! - 20 * 60_000
  const total = variableStarSessionDurationSeconds({ blockHours: 2, raHours, startMs })
  assert.equal(variableStarBlockHoursFromTotalSeconds(total, { raHours, startMs }), 2)
})
