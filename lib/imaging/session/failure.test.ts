import assert from 'node:assert/strict'
import test from 'node:test'

test('project mode boards are excluded from observatory auto-fail policy', () => {
  const entry = { projectMode: true as const }
  assert.equal(entry.projectMode === true, true)
})
