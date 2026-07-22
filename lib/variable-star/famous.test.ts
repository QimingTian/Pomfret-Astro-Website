import assert from 'node:assert/strict'
import test from 'node:test'
import { isFamousVariableStar, normalizeVariableStarName } from '@/lib/variable-star/famous'
import { rowMatchesFilter } from '@/lib/variable-star/filters'
import type { VariableStarRow } from '@/lib/variable-star-catalog'

test('normalizeVariableStarName strips V* prefix', () => {
  assert.equal(normalizeVariableStarName('V* SS Cyg'), 'SS CYG')
})

test('isFamousVariableStar matches seed list', () => {
  assert.equal(isFamousVariableStar('AW UMa'), true)
  assert.equal(isFamousVariableStar('GSC 04415-01754'), false)
})

test('rowMatchesFilter famous uses category tag', () => {
  const row: VariableStarRow = {
    name: 'GSC 1',
    raHours: 1,
    decDeg: 30,
    varType: 'EW',
    periodDays: 0.3,
    minMag: 10,
    maxMag: 9,
    highPriority: false,
    categories: ['famous'],
  }
  assert.equal(rowMatchesFilter(row, 'famous'), true)
})
