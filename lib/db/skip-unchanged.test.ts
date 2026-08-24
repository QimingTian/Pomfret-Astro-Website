import assert from 'node:assert/strict'
import test from 'node:test'

import { sameJson, stripNinaJsonFromProjectDocument } from './skip-unchanged'

test('sameJson treats identical documents as equal', () => {
  assert.equal(sameJson({ id: 'a', status: 'scheduled' }, { id: 'a', status: 'scheduled' }), true)
  assert.equal(sameJson({ id: 'a' }, { id: 'b' }), false)
})

test('stripNinaJsonFromProjectDocument drops sequencer JSON from nights only', () => {
  const stripped = stripNinaJsonFromProjectDocument({
    id: 'p1',
    target: 'M101',
    nights: [
      {
        id: 'n1',
        status: 'scheduled',
        ninaSequenceJson: '{"huge":true}',
        filterPlansTonight: [{ filterName: 'L' }],
      },
    ],
  })
  assert.equal(stripped.id, 'p1')
  const nights = stripped.nights as Array<Record<string, unknown>>
  assert.equal(nights[0]?.ninaSequenceJson, undefined)
  assert.deepEqual(nights[0]?.filterPlansTonight, [{ filterName: 'L' }])
})
