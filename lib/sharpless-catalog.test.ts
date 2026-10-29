import assert from 'node:assert/strict'
import test from 'node:test'
import catalog from './sharpless-j2000.json'
import { resolveSharplessTarget } from './sharpless-catalog'

test('local Sharpless catalog covers every Sh2 designation', () => {
  assert.equal(catalog.epoch, 'J2000')
  assert.equal(catalog.entries.length, 313)
  for (let number = 1; number <= 313; number++) {
    const resolved = resolveSharplessTarget(`Sh2-${number}`)
    assert.equal(resolved?.canonicalName, `Sh2-${number}`)
    assert.ok(resolved && resolved.raHours >= 0 && resolved.raHours < 24)
    assert.ok(resolved && resolved.decDeg >= -90 && resolved.decDeg <= 90)
  }
})

test('Sh2-221 resolves locally with its J2000 position and common spelling variants', () => {
  const expected = { canonicalName: 'Sh2-221', aliases: ['Sh 2-221', 'Sharpless 221'], raHours: 5.02758333, decDeg: 46.34888889 }
  for (const query of ['Sh2-221', 'SH 2 221', 'Sharpless 221', 'sharpless 2-221']) {
    assert.deepEqual(resolveSharplessTarget(query), expected)
  }
  assert.equal(resolveSharplessTarget('Sh2-314'), null)
  assert.equal(resolveSharplessTarget('NGC 221'), null)
})
