import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCoordsFromFormParts, sexagesimalPartsFromRadec } from './coords'

test('sexagesimalPartsFromRadec splits RA and Dec', () => {
  const p = sexagesimalPartsFromRadec(12.5, -41.25)
  assert.equal(p.raHourPart, '12')
  assert.equal(p.raMinutePart, '30')
  assert.equal(p.decSign, '-')
  assert.equal(p.decDegreePart, '41')
})

test('parseCoordsFromFormParts accepts valid sexagesimal', () => {
  const r = parseCoordsFromFormParts('12', '34', '56', '+', '41', '12', '30')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.raHours, 12.58222222)
  assert.equal(r.decDeg, 41.20833333)
})

test('parseCoordsFromFormParts rejects out-of-range RA', () => {
  const r = parseCoordsFromFormParts('24', '0', '0', '+', '0', '0', '0')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.message, /RA range/)
})

test('parseCoordsFromFormParts rejects non-numeric Dec', () => {
  const r = parseCoordsFromFormParts('1', '0', '0', '-', 'x', '0', '0')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.message, /Dec requires numeric/)
})
