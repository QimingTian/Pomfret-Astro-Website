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

test('sexagesimalPartsFromRadec carries 60″ from float declination (Sh2-129)', () => {
  const dec = 59 + 57 / 60
  const p = sexagesimalPartsFromRadec(21.196667, dec)
  assert.equal(p.decSecondPart, '0')
  const r = parseCoordsFromFormParts(
    p.raHourPart,
    p.raMinutePart,
    p.raSecondPart,
    p.decSign,
    p.decDegreePart,
    p.decMinutePart,
    p.decSecondPart
  )
  assert.equal(r.ok, true)
})

test('parseCoordsFromFormParts carries 59°57′60″ to 59°58′0″', () => {
  const r = parseCoordsFromFormParts('21', '11', '48', '+', '59', '57', '60')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.decDeg, 59.96666667)
})
