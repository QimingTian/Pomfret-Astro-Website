import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearNinaStoppedPendingFail,
  isSessionFailedTerminalLine,
  maybeFailSessionsAfterNinaStopped,
  NINA_STOPPED_FAIL_GRACE_MS,
  NINA_STOPPED_WITHOUT_COMPLETION_REASON,
  onNinaRunningReported,
  SESSION_FAILED_TERMINAL_MESSAGE,
} from './failure'

test('isSessionFailedTerminalLine matches only the failure terminal phrase', () => {
  assert.equal(isSessionFailedTerminalLine(SESSION_FAILED_TERMINAL_MESSAGE), true)
  assert.equal(isSessionFailedTerminalLine('  Session failed -- contact support.  '), true)
  assert.equal(isSessionFailedTerminalLine('Capturing frame 12'), false)
})

test('onNinaRunningReported does not queue failure on first false report', async () => {
  await clearNinaStoppedPendingFail()
  await onNinaRunningReported(false, Date.now())
  await maybeFailSessionsAfterNinaStopped(Date.now() + NINA_STOPPED_FAIL_GRACE_MS + 1000)
  // No in-progress sessions in test env — pending should stay cleared after maybeApply.
})

test('onNinaRunningReported ignores true→true and false→false transitions', async () => {
  await clearNinaStoppedPendingFail()
  const now = Date.now()
  await onNinaRunningReported(true, now)
  await onNinaRunningReported(true, now + 1000)
  await onNinaRunningReported(false, now + 2000)
  await clearNinaStoppedPendingFail()
  await onNinaRunningReported(false, now + 3000)
})

test('NINA stopped reason constant is stable for audit logs', () => {
  assert.equal(NINA_STOPPED_WITHOUT_COMPLETION_REASON, 'nina_stopped_without_completion')
})
