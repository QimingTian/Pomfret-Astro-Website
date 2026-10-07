import assert from 'node:assert/strict'
import test from 'node:test'

import '@/lib/observatory-site-als'
import { buildNinaSequenceJson } from '@/lib/imaging/nina/sequence-json'

test('asteroid occultation sequence writes the server exposure into the L loop', () => {
  const json = buildNinaSequenceJson({
    raHoursDecimal: 2.5,
    decDegDecimal: 20,
    filterName: 'Ha',
    exposureSeconds: 0.5,
    exposureCount: 3728,
    pomfretQueueId: 'occ-1',
    templateKind: 'asteroid_occultation',
    targetName: '(704) Interamnia',
  })
  const root = JSON.parse(json) as {
    Name?: string
    PomfretAstro?: { SequenceTemplate?: string; FilterName?: string }
  }
  assert.equal(root.Name, 'Asteroid Occultation Sequence')
  assert.equal(root.PomfretAstro?.SequenceTemplate, 'asteroid_occultation')
  assert.equal(root.PomfretAstro?.FilterName, 'L')
  assert.match(json, /"ExposureTime": 0\.5/)
  assert.match(json, /"Iterations": 3728/)
})
