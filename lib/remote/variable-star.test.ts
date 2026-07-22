import assert from 'node:assert/strict'
import test from 'node:test'
import { pickVariableStarRow, rowToVariableChartStar } from './variable-star'
import type { VariableStarRow } from '@/lib/variable-star-catalog'

const catalog: VariableStarRow[] = [
  {
    name: 'V1234 Cas',
    raHours: 1,
    decDeg: 2,
    periodDays: 0.5,
    minMag: 10,
    maxMag: 11,
    varType: 'EA',
    highPriority: true,
  },
  {
    name: 'V5678 Cas',
    raHours: 3,
    decDeg: 4,
    periodDays: 1,
    minMag: 9,
    maxMag: 10,
    varType: 'M',
    highPriority: false,
  },
]

test('rowToVariableChartStar copies chart fields', () => {
  const star = rowToVariableChartStar(catalog[0]!)
  assert.equal(star.name, 'V1234 Cas')
  assert.equal(star.raHours, 1)
  assert.equal(star.periodDays, 0.5)
})

test('pickVariableStarRow exact match', () => {
  const r = pickVariableStarRow(catalog, 'v1234 cas')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.row.name, 'V1234 Cas')
})

test('pickVariableStarRow partial unique match', () => {
  const r = pickVariableStarRow(catalog, '5678')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.row.name, 'V5678 Cas')
})

test('pickVariableStarRow empty query', () => {
  const r = pickVariableStarRow(catalog, '   ')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /Enter a variable star/)
})

test('pickVariableStarRow no match', () => {
  const r = pickVariableStarRow(catalog, 'ZZZ')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /No variable star/)
})
