import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterVariableStarCatalog,
  rowMatchesTypeFilter,
  rowMatchesPeriodFilter,
} from '@/lib/variable-star/filters'
import type { VariableStarRow } from '@/lib/variable-star-catalog'

const base: VariableStarRow = {
  name: 'SS Cyg',
  raHours: 21.7,
  decDeg: 43.6,
  varType: 'UGSS',
  periodDays: 0.28,
  minMag: 12.4,
  maxMag: 7.7,
  highPriority: false,
  categories: ['type_cv', 'short_period'],
}

test('rowMatchesTypeFilter uses categories tag', () => {
  assert.equal(rowMatchesTypeFilter(base, 'type_cv'), true)
  assert.equal(rowMatchesTypeFilter(base, 'type_rr'), false)
})

test('rowMatchesPeriodFilter uses categories tag', () => {
  assert.equal(rowMatchesPeriodFilter(base, 'short_period'), true)
  assert.equal(rowMatchesPeriodFilter(base, 'long_period'), false)
})

test('filterVariableStarCatalog ANDs groups', () => {
  const rows: VariableStarRow[] = [
    base,
    { ...base, name: 'T UMi', varType: 'M', periodDays: 301.72, categories: ['type_m', 'long_period'] },
  ]
  const out = filterVariableStarCatalog(rows, ['type_cv', 'short_period'])
  assert.equal(out.length, 1)
  assert.equal(out[0]?.name, 'SS Cyg')
})

test('type_rr and type_cep inference', () => {
  const rr: VariableStarRow = { ...base, name: 'RR Lyr', varType: 'RR', categories: undefined }
  const cep: VariableStarRow = { ...base, name: 'delta Cep', varType: 'DCEP', categories: undefined }
  assert.equal(rowMatchesTypeFilter(rr, 'type_rr'), true)
  assert.equal(rowMatchesTypeFilter(cep, 'type_cep'), true)
})
