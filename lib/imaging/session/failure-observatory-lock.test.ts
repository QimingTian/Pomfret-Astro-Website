import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_MARK_SESSION_FAILED_REASON,
  shouldLockObservatoryOnSessionFailure,
} from './failure-observatory-lock'
import { NINA_STOPPED_WITHOUT_COMPLETION_REASON } from './failure'

test('shouldLockObservatoryOnSessionFailure skips ESTOP and delivery handoffs', () => {
  assert.equal(shouldLockObservatoryOnSessionFailure('emergency_stop'), false)
  assert.equal(shouldLockObservatoryOnSessionFailure('interrupted_before_new_nina_delivery'), false)
  assert.equal(shouldLockObservatoryOnSessionFailure('interrupted_before_admin_force_run_delivery'), false)
})

test('shouldLockObservatoryOnSessionFailure locks on real failures', () => {
  assert.equal(shouldLockObservatoryOnSessionFailure(NINA_STOPPED_WITHOUT_COMPLETION_REASON), true)
  assert.equal(shouldLockObservatoryOnSessionFailure(ADMIN_MARK_SESSION_FAILED_REASON), true)
})
