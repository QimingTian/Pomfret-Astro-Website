import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSessionFailedTerminalLine,
  SESSION_FAILED_TERMINAL_MESSAGE,
} from './failure'

test('project mode boards are excluded from observatory auto-fail policy', () => {
  const entry = { projectMode: true as const }
  assert.equal(entry.projectMode === true, true)
})

test('isSessionFailedTerminalLine matches only the failure terminal phrase', () => {
  assert.equal(isSessionFailedTerminalLine(SESSION_FAILED_TERMINAL_MESSAGE), true)
  assert.equal(isSessionFailedTerminalLine('  Session failed -- contact support.  '), true)
  assert.equal(isSessionFailedTerminalLine('Capturing frame 12'), false)
})
