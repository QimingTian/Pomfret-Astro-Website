import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVsxMagPair, vsxRowToCandidate } from '@/lib/variable-star/vsx'

test('parseVsxMagPair handles VizieR Y amplitude flag', () => {
  const p = parseVsxMagPair('14.407', '0.080', 'Y')
  assert.equal(p.faintestMag, 14.487)
})

test('vsxRowToCandidate rejects faint stars', () => {
  const row = {
    name: 'Faint Star',
    raDeg: '120',
    decDeg: '30',
    max: '15.5',
    min: '16.0',
    fMin: '',
    type: 'M',
    period: '200',
  }
  assert.equal(vsxRowToCandidate(row), null)
})

test('vsxRowToCandidate accepts Pomfret-visible star', () => {
  const row = {
    name: 'SS Cyg',
    raDeg: '325.678',
    decDeg: '43.586',
    max: '7.7',
    min: '12.4',
    fMin: '',
    type: 'UGSS',
    period: '0.27513',
  }
  const c = vsxRowToCandidate(row)
  assert.ok(c)
  assert.equal(c?.name, 'SS Cyg')
})
