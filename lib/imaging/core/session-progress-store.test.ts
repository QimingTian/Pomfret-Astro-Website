import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendSessionProgressLine,
  clearSessionProgressLines,
  listSessionProgressLines,
} from './session-progress-store'

test('appendSessionProgressLine keeps chronological memory lines', async () => {
  const id = `test-progress-${Date.now()}`
  await clearSessionProgressLines(id)
  await appendSessionProgressLine(id, { at: '2026-01-01T00:00:00.000Z', text: 'a' })
  await appendSessionProgressLine(id, { at: '2026-01-01T00:00:01.000Z', text: 'b' })
  const lines = await listSessionProgressLines(id)
  assert.deepEqual(
    lines.map((l) => l.text),
    ['a', 'b']
  )
  await clearSessionProgressLines(id)
})
