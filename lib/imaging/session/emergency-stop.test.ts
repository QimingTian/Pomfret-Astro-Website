import assert from 'node:assert/strict'
import test from 'node:test'
import {
  armEmergencyStop,
  clearEmergencyStopAfterManualUnlock,
  emergencyStopLabelForPhase,
  emergencyStopProgressForState,
  getEmergencyStopPublicState,
  getEmergencyStopState,
  isEmergencyStopBlocking,
  isEmergencyStopQueueId,
  isEmergencyStopStopped,
  isEmergencyStopStopping,
  markEmergencyStopCompleted,
  markEmergencyStopDelivered,
  resetEmergencyStopForTests,
  shouldClearEmergencyStopOnObservatoryPatch,
  type EmergencyStopState,
} from './emergency-stop'
import { resolveSessionProgressQueueId } from './progress-queue'

type GlobalWithEstop = typeof globalThis & {
  __pomfret_emergency_stop__?: EmergencyStopState | null
}

test('isEmergencyStopQueueId recognizes estop queue ids', () => {
  assert.equal(isEmergencyStopQueueId('estop-123'), true)
  assert.equal(isEmergencyStopQueueId('queue-abc'), false)
})

test('emergencyStopProgressForState maps phases to 0/33/66/100', () => {
  assert.equal(emergencyStopProgressForState(null), 0)
  assert.equal(
    emergencyStopProgressForState({
      phase: 'stopping',
      queueId: 'estop-1',
      requestedAt: '2026-01-01T00:00:00.000Z',
      heldSessionIds: [],
    }),
    33
  )
  assert.equal(
    emergencyStopProgressForState({
      phase: 'stopping',
      queueId: 'estop-1',
      requestedAt: '2026-01-01T00:00:00.000Z',
      deliveredAt: '2026-01-01T00:00:05.000Z',
      heldSessionIds: [],
    }),
    66
  )
  assert.equal(
    emergencyStopProgressForState({
      phase: 'stopped',
      queueId: 'estop-1',
      requestedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      heldSessionIds: [],
    }),
    100
  )
})

test('emergencyStopLabelForPhase maps idle/stopping/stopped labels', () => {
  assert.equal(emergencyStopLabelForPhase('idle'), 'ESTOP')
  assert.equal(emergencyStopLabelForPhase('stopping'), 'STOPPING')
  assert.equal(emergencyStopLabelForPhase('stopped'), 'STOPPED')
})

test('emergency stop async state machine', async (t) => {
  await t.test('blocking and stopping helpers follow phase', async () => {
    await resetEmergencyStopForTests()
    assert.equal(await isEmergencyStopBlocking(), false)

    await armEmergencyStop('admin', ['sess-1'])
    assert.equal(await isEmergencyStopBlocking(), true)
    assert.equal(await isEmergencyStopStopping(), true)

    const state = await getEmergencyStopState()
    assert.ok(state)
    await markEmergencyStopCompleted(state.queueId)
    assert.equal(await isEmergencyStopStopped(), true)

    await resetEmergencyStopForTests()
  })

  await t.test('markEmergencyStopDelivered advances progress to 66%', async () => {
    await resetEmergencyStopForTests()
    const armed = await armEmergencyStop('admin')
    await markEmergencyStopDelivered(armed.queueId)
    const publicState = await getEmergencyStopPublicState(true)
    assert.equal(publicState.progress, 66)
    await resetEmergencyStopForTests()
  })

  await t.test('readState prefers KV over stale in-memory copy when KV is enabled', async () => {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return

    await resetEmergencyStopForTests()
    const armed = await armEmergencyStop('admin', [])
    ;(globalThis as GlobalWithEstop).__pomfret_emergency_stop__ = {
      ...armed,
      deliveredAt: undefined,
    }
    await markEmergencyStopDelivered(armed.queueId)
    const state = await getEmergencyStopState()
    assert.equal(state?.deliveredAt != null, true)
    await resetEmergencyStopForTests()
  })

  await t.test('getEmergencyStopPublicState exposes canArm only when idle and agent connected', async () => {
    await resetEmergencyStopForTests()
    const idleConnected = await getEmergencyStopPublicState(true)
    assert.equal(idleConnected.phase, 'idle')
    assert.equal(idleConnected.canArm, true)

    await armEmergencyStop('admin')
    const stopping = await getEmergencyStopPublicState(true)
    assert.equal(stopping.canArm, false)
    await resetEmergencyStopForTests()
  })

  await t.test('clearEmergencyStopAfterManualUnlock returns held ids and clears state', async () => {
    await resetEmergencyStopForTests()
    await armEmergencyStop('admin', ['a', 'b'])
    const cleared = await clearEmergencyStopAfterManualUnlock()
    assert.deepEqual(cleared?.heldSessionIds, ['a', 'b'])
    assert.equal(await isEmergencyStopBlocking(), false)
    await resetEmergencyStopForTests()
  })

  await t.test('resolveSessionProgressQueueId routes Dome Closed to active ESTOP', async () => {
    await resetEmergencyStopForTests()
    const armed = await armEmergencyStop('admin')
    const queueId = await resolveSessionProgressQueueId({ text: 'Dome Closed' })
    assert.equal(queueId, armed.queueId)
    await resetEmergencyStopForTests()
  })
})

test('shouldClearEmergencyStopOnObservatoryPatch when status or mode leaves lock', () => {
  const locked = {
    currentMode: 'manual' as const,
    currentStatus: 'closed_observatory_maintenance' as const,
  }

  assert.equal(
    shouldClearEmergencyStopOnObservatoryPatch({
      ...locked,
      status: 'ready',
    }),
    true
  )
  assert.equal(
    shouldClearEmergencyStopOnObservatoryPatch({
      ...locked,
      mode: 'auto',
    }),
    true
  )
  assert.equal(
    shouldClearEmergencyStopOnObservatoryPatch({
      ...locked,
      status: 'closed_observatory_maintenance',
      mode: 'manual',
    }),
    false
  )
  assert.equal(
    shouldClearEmergencyStopOnObservatoryPatch({
      ...locked,
      status: 'ready',
      mode: 'auto',
    }),
    true
  )
})
