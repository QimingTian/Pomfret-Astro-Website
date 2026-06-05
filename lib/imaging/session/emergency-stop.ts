import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

const KV_KEY = 'imaging-emergency-stop'

export type EmergencyStopPhase = 'stopping' | 'stopped'

export type EmergencyStopProgress = 0 | 33 | 66 | 100

export type EmergencyStopState = {
  phase: EmergencyStopPhase
  queueId: string
  requestedAt: string
  requestedBy?: string | null
  deliveredAt?: string | null
  completedAt?: string | null
  clearedAt?: string | null
  heldSessionIds: string[]
}

export type EmergencyStopPublicPhase = 'idle' | EmergencyStopPhase

export type EmergencyStopPublicState = {
  phase: EmergencyStopPublicPhase
  progress: EmergencyStopProgress
  label: 'ESTOP' | 'STOPPING' | 'STOPPED'
  queueId: string | null
  canArm: boolean
  blocking: boolean
  stopped: boolean
}

type GlobalWithEstop = typeof globalThis & {
  __pomfret_emergency_stop__?: EmergencyStopState | null
}

function memoryState(): EmergencyStopState | null {
  return (globalThis as GlobalWithEstop).__pomfret_emergency_stop__ ?? null
}

function setMemoryState(state: EmergencyStopState | null): void {
  ;(globalThis as GlobalWithEstop).__pomfret_emergency_stop__ = state
}

function normalizeState(raw: unknown): EmergencyStopState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const queueId = typeof r.queueId === 'string' ? r.queueId.trim() : ''
  if (!queueId) return null

  let phase: EmergencyStopPhase | null = null
  if (r.phase === 'stopping' || r.phase === 'stopped') {
    phase = r.phase
  } else if (r.armed === true) {
    phase = 'stopping'
  }
  if (!phase) return null

  const heldSessionIds = Array.isArray(r.heldSessionIds)
    ? r.heldSessionIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  return {
    phase,
    queueId,
    requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : new Date().toISOString(),
    requestedBy: typeof r.requestedBy === 'string' ? r.requestedBy : null,
    deliveredAt: typeof r.deliveredAt === 'string' ? r.deliveredAt : null,
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
    clearedAt: typeof r.clearedAt === 'string' ? r.clearedAt : null,
    heldSessionIds,
  }
}

async function readState(): Promise<EmergencyStopState | null> {
  if (kvEnabled()) {
    const remote = await kvGetJson<unknown>(KV_KEY)
    const normalized = normalizeState(remote)
    setMemoryState(normalized)
    return normalized
  }
  return memoryState()
}

async function writeState(state: EmergencyStopState | null): Promise<void> {
  setMemoryState(state)
  if (!kvEnabled()) return
  if (!state) {
    await kvSetJson(KV_KEY, { phase: null, clearedAt: new Date().toISOString() })
    return
  }
  await kvSetJson(KV_KEY, state)
}

export function isEmergencyStopQueueId(queueId: string): boolean {
  return queueId.startsWith('estop-')
}

export function emergencyStopProgressForState(
  state: EmergencyStopState | null
): EmergencyStopProgress {
  if (!state) return 0
  if (state.phase === 'stopped') return 100
  if (state.deliveredAt) return 66
  return 33
}

export function emergencyStopLabelForPhase(
  phase: EmergencyStopPublicPhase
): EmergencyStopPublicState['label'] {
  if (phase === 'stopping') return 'STOPPING'
  if (phase === 'stopped') return 'STOPPED'
  return 'ESTOP'
}

export async function getEmergencyStopState(): Promise<EmergencyStopState | null> {
  return readState()
}

export async function getEmergencyStopPublicState(
  agentConnected: boolean
): Promise<EmergencyStopPublicState> {
  const state = await readState()
  const phase: EmergencyStopPublicPhase = state?.phase ?? 'idle'
  const progress = emergencyStopProgressForState(state)
  return {
    phase,
    progress,
    label: emergencyStopLabelForPhase(phase),
    queueId: state?.queueId ?? null,
    canArm: phase === 'idle' && agentConnected,
    blocking: phase === 'stopping' || phase === 'stopped',
    stopped: phase === 'stopped',
  }
}

/** @deprecated Use isEmergencyStopBlocking */
export async function isEmergencyStopArmed(): Promise<boolean> {
  return isEmergencyStopBlocking()
}

export async function isEmergencyStopBlocking(): Promise<boolean> {
  const state = await readState()
  return state?.phase === 'stopping' || state?.phase === 'stopped'
}

export async function isEmergencyStopStopped(): Promise<boolean> {
  const state = await readState()
  return state?.phase === 'stopped'
}

export async function isEmergencyStopStopping(): Promise<boolean> {
  const state = await readState()
  return state?.phase === 'stopping'
}

export async function armEmergencyStop(
  requestedBy?: string | null,
  heldSessionIds: string[] = []
): Promise<EmergencyStopState> {
  const queueId = `estop-${Date.now()}`
  const state: EmergencyStopState = {
    phase: 'stopping',
    queueId,
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy ?? null,
    heldSessionIds: [...heldSessionIds],
  }
  await writeState(state)
  return state
}

export async function updateEmergencyStopHeldSessionIds(
  heldSessionIds: string[]
): Promise<void> {
  const state = await readState()
  if (!state) return
  await writeState({ ...state, heldSessionIds: [...heldSessionIds] })
}

export async function markEmergencyStopDelivered(queueId: string): Promise<void> {
  const state = await readState()
  if (!state || state.queueId !== queueId || state.phase !== 'stopping') return
  if (state.deliveredAt) return
  await writeState({ ...state, deliveredAt: new Date().toISOString() })
}

export async function markEmergencyStopCompleted(queueId: string): Promise<void> {
  const state = await readState()
  if (!state || state.queueId !== queueId) return
  if (state.phase === 'stopped' && state.completedAt) return
  await writeState({
    ...state,
    phase: 'stopped',
    completedAt: new Date().toISOString(),
  })
}

export async function clearEmergencyStopAfterManualUnlock(): Promise<EmergencyStopState | null> {
  const state = await readState()
  if (!state) return null
  const heldSessionIds = [...state.heldSessionIds]
  await writeState(null)
  setMemoryState(null)
  return { ...state, heldSessionIds }
}

/** Test helper: clear in-memory and KV ESTOP state. */
export async function resetEmergencyStopForTests(): Promise<void> {
  setMemoryState(null)
  if (kvEnabled()) {
    await kvSetJson(KV_KEY, { phase: null, clearedAt: new Date().toISOString() })
  }
}

/** Whether admin observatory PATCH should clear the STOPPED lock. */
export function shouldClearEmergencyStopOnObservatoryPatch(input: {
  mode?: ObservatoryModeInput
  status?: ObservatoryStatusInput
  currentMode: ObservatoryModeInput
  currentStatus: ObservatoryStatusInput
}): boolean {
  const nextMode = input.mode ?? input.currentMode
  const nextStatus = input.status ?? input.currentStatus
  return nextMode !== 'manual' || nextStatus !== 'closed_observatory_maintenance'
}

type ObservatoryModeInput = 'manual' | 'auto'
type ObservatoryStatusInput =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'
