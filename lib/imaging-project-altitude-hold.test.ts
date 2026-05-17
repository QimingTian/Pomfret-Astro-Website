import assert from 'node:assert/strict'
import test from 'node:test'
import { intervalsWhereAltitudeAtOrAbove } from './target-altitude'

test('intervalsWhereAltitudeAtOrAbove returns contiguous runs', () => {
  // Circumpolar-ish dec at Pomfret: long above-30 window
  const startMs = Date.parse('2026-05-18T01:00:00.000Z')
  const endMs = Date.parse('2026-05-18T08:00:00.000Z')
  const intervals = intervalsWhereAltitudeAtOrAbove(12, 45, startMs, endMs)
  assert.ok(intervals.length >= 1)
  for (const iv of intervals) {
    assert.ok(iv.endMs > iv.startMs)
    assert.ok(iv.startMs >= startMs)
    assert.ok(iv.endMs <= endMs)
  }
})
