import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  astroConditionIsRed,
  formatAstroConditionLabel,
  parseSevenTimerInitUtc,
  pickCurrentAstroSeriesEntry,
} from '@/lib/astro-conditions'

test('parseSevenTimerInitUtc reads YYYYMMDDHH as UTC', () => {
  const d = parseSevenTimerInitUtc('2026071906')
  assert.ok(d)
  assert.equal(d.toISOString(), '2026-07-19T06:00:00.000Z')
})

test('pickCurrentAstroSeriesEntry chooses nearest 3h step', () => {
  const series = [{ timepoint: 3 }, { timepoint: 6 }, { timepoint: 9 }]
  // init 06:00 UTC; now 11:00 UTC → nearer 6h step (12:00) than 3h (09:00)
  const now = new Date('2026-07-19T11:00:00.000Z')
  const picked = pickCurrentAstroSeriesEntry('2026071906', series, now)
  assert.equal(picked?.timepoint, 6)
})

test('formatAstroConditionLabel includes word + scale', () => {
  assert.equal(formatAstroConditionLabel(1), 'Excellent (1)')
  assert.equal(formatAstroConditionLabel(4), 'Average (4)')
  assert.equal(formatAstroConditionLabel(null), '—')
})

test('astroConditionIsRed marks 5+', () => {
  assert.equal(astroConditionIsRed(4), false)
  assert.equal(astroConditionIsRed(5), true)
  assert.equal(astroConditionIsRed(null), false)
})
