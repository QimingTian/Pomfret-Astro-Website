import type { ImagingAdminActor } from '@/lib/imaging/core/admin-auth'
import { emergencyStopActorLabel } from '@/lib/imaging/session/emergency-stop-display'
import { emitAgentWake } from '@/lib/imaging/site-events'
import { kvCompareAndSet, kvEnabled, kvGetJson, kvGetString, kvSetJson } from '@/lib/kv-rest'

const KV_KEY = 'imaging-emergency-stop'
const CAS_ATTEMPTS = 6
/** Un-delivered stopping state older than this is cleared instead of delivered (orphan KV). */
const STALE_UNDELIVERED_STOPPING_MS = 6 * 60 * 60 * 1000

export type EmergencyStopPhase = 'stopping' | 'stopped'

export type EmergencyStopProgress = 0 | 33 | 66 | 100

export type EmergencyStopState = {
  phase: EmergencyStopPhase
  queueId: string
  requestedAt: string
  requestedBy?: string | null
  requestedByUserId?: string | null
  requestedByUsername?: string | null
  requestedByEmail?: string | null
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
    requestedByUserId: typeof r.requestedByUserId === 'string' ? r.requestedByUserId : null,
    requestedByUsername: typeof r.requestedByUsername === 'string' ? r.requestedByUsername : null,
    requestedByEmail: typeof r.requestedByEmail === 'string' ? r.requestedByEmail : null,
    deliveredAt: typeof r.deliveredAt === 'string' ? r.deliveredAt : null,
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
    clearedAt: typeof r.clearedAt === 'string' ? r.clearedAt : null,
    heldSessionIds,
  }
}

async function notifyEstopChanged(armAgent = false): Promise<void> {
  const { emitSiteEstop } = await import('@/lib/imaging/site-events-server')
  await emitSiteEstop()
  if (armAgent) emitAgentWake('estop')
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

function serializeStateForKv(state: EmergencyStopState | null): string {
  if (!state) {
    return JSON.stringify({ phase: null, clearedAt: new Date().toISOString() })
  }
  return JSON.stringify(state)
}

async function readStateRaw(): Promise<{ state: EmergencyStopState | null; raw: string }> {
  if (kvEnabled()) {
    const raw = await kvGetString(KV_KEY)
    if (raw === undefined) return { state: null, raw: '' }
    try {
      const normalized = normalizeState(JSON.parse(raw) as unknown)
      setMemoryState(normalized)
      return { state: normalized, raw }
    } catch {
      return { state: null, raw: '' }
    }
  }
  const state = memoryState()
  return { state, raw: state ? JSON.stringify(state) : '' }
}

type CasWriteResult = 'ok' | 'abort' | 'conflict'

async function compareAndWriteState(
  mutate: (current: EmergencyStopState | null) => EmergencyStopState | null | 'abort'
): Promise<CasWriteResult> {
  if (!kvEnabled()) {
    const next = mutate(memoryState())
    if (next === 'abort') return 'abort'
    setMemoryState(next)
    return 'ok'
  }

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const { state: current, raw } = await readStateRaw()
    const next = mutate(current)
    if (next === 'abort') return 'abort'
    const ok = await kvCompareAndSet(KV_KEY, raw, serializeStateForKv(next))
    if (ok) {
      setMemoryState(next)
      return 'ok'
    }
  }
  return 'conflict'
}

async function writeState(state: EmergencyStopState | null): Promise<boolean> {
  const result = await compareAndWriteState(() => state)
  return result === 'ok'
}

export function isStaleUndeliveredEmergencyStop(state: EmergencyStopState): boolean {
  if (state.deliveredAt || state.phase !== 'stopping') return false
  const requestedMs = Date.parse(state.requestedAt)
  if (!Number.isFinite(requestedMs)) return false
  return Date.now() - requestedMs > STALE_UNDELIVERED_STOPPING_MS
}

/** Drop orphan stopping rows left in KV (explains deliver logs with no recent armed). */
export async function clearStaleUndeliveredEmergencyStop(
  state: EmergencyStopState
): Promise<boolean> {
  if (!isStaleUndeliveredEmergencyStop(state)) return false
  const result = await compareAndWriteState((current) => {
    if (!current || current.queueId !== state.queueId) return 'abort'
    if (!isStaleUndeliveredEmergencyStop(current)) return 'abort'
    return null
  })
  return result === 'ok'
}

export {
  emergencyStopActorLabel,
  emergencyStopTriggeredBySuffix,
} from '@/lib/imaging/session/emergency-stop-display'

export function isEmergencyStopQueueId(queueId: string): boolean {
  return queueId.startsWith('estop-')
}

export function emergencyStopAuditDetail(
  input: {
    queueId: string
    requestedAt?: string | null
    requestedBy?: string | null
    requestedByUserId?: string | null
    requestedByUsername?: string | null
    requestedByEmail?: string | null
  } & Record<string, unknown>
): Record<string, unknown> {
  const {
    queueId,
    requestedAt,
    requestedBy,
    requestedByUserId,
    requestedByUsername,
    requestedByEmail,
    ...rest
  } = input
  const who = emergencyStopActorLabel({ requestedBy, requestedByEmail, requestedByUsername })
  return {
    queueId,
    ...(requestedAt ? { requestedAt } : {}),
    requestedBy: who,
    ...(requestedByUserId ? { requestedByUserId } : {}),
    ...(requestedByUsername ? { requestedByUsername } : {}),
    ...(requestedByEmail ? { requestedByEmail } : {}),
    ...rest,
  }
}

export function emergencyStopAuditDetailFromState(
  state: {
    queueId: string
    requestedAt?: string | null
    requestedBy?: string | null
    requestedByUserId?: string | null
    requestedByUsername?: string | null
    requestedByEmail?: string | null
  } & Record<string, unknown>
): Record<string, unknown> {
  const { queueId, requestedAt, requestedBy, requestedByUserId, requestedByUsername, requestedByEmail, ...rest } =
    state
  return emergencyStopAuditDetail({
    queueId,
    requestedAt,
    requestedBy,
    requestedByUserId,
    requestedByUsername,
    requestedByEmail,
    ...rest,
  })
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

export type ArmEmergencyStopResult = {
  state: EmergencyStopState
  newlyArmed: boolean
}

export async function armEmergencyStop(
  actor: ImagingAdminActor | string,
  heldSessionIds: string[] = []
): Promise<ArmEmergencyStopResult> {
  const resolvedActor: ImagingAdminActor =
    typeof actor === 'string'
      ? { displayName: actor, userId: '', username: actor, email: '' }
      : actor
  const queueId = `estop-${Date.now()}`
  const state: EmergencyStopState = {
    phase: 'stopping',
    queueId,
    requestedAt: new Date().toISOString(),
    requestedBy: resolvedActor.displayName,
    requestedByUserId: resolvedActor.userId || null,
    requestedByUsername: resolvedActor.username || null,
    requestedByEmail: resolvedActor.email || null,
    heldSessionIds: [...heldSessionIds],
  }
  const result = await compareAndWriteState((current) => {
    if (current?.phase === 'stopping' || current?.phase === 'stopped') {
      return 'abort'
    }
    return state
  })
  if (result !== 'ok') {
    const existing = await readState()
    if (existing) {
      return { state: existing, newlyArmed: false }
    }
    return { state, newlyArmed: false }
  }
  await notifyEstopChanged(true)
  const { getTonightScheduleStrip } = await import('@/lib/schedule-strip')
  const { prepareEndNightAfterEstop } = await import('@/lib/end-night-state')
  await prepareEndNightAfterEstop(getTonightScheduleStrip().nightKey)
  return { state, newlyArmed: true }
}

export async function updateEmergencyStopHeldSessionIds(
  heldSessionIds: string[]
): Promise<void> {
  const state = await readState()
  if (!state) return
  await compareAndWriteState((current) => {
    if (!current) return 'abort'
    return { ...current, heldSessionIds: [...heldSessionIds] }
  })
}

/** Returns true only the first time this queueId is marked delivered (CAS). */
export async function markEmergencyStopDelivered(queueId: string): Promise<boolean> {
  let marked = false
  const result = await compareAndWriteState((current) => {
    if (!current || current.queueId !== queueId || current.phase !== 'stopping') return 'abort'
    if (current.deliveredAt) return 'abort'
    marked = true
    return { ...current, deliveredAt: new Date().toISOString() }
  })
  if (marked && result === 'ok') void notifyEstopChanged()
  return marked && result === 'ok'
}

/** Returns true when phase is persisted as stopped in KV. */
export async function markEmergencyStopCompleted(queueId: string): Promise<boolean> {
  let completed = false
  const result = await compareAndWriteState((current) => {
    if (!current || current.queueId !== queueId) return 'abort'
    if (current.phase === 'stopped' && current.completedAt) return 'abort'
    if (current.phase !== 'stopping') return 'abort'
    completed = true
    return {
      ...current,
      phase: 'stopped',
      completedAt: new Date().toISOString(),
    }
  })
  if (completed && result === 'ok') void notifyEstopChanged()
  return completed && result === 'ok'
}

export async function clearEmergencyStopAfterManualUnlock(): Promise<EmergencyStopState | null> {
  const before = await readState()
  if (!before) return null
  const heldSessionIds = [...before.heldSessionIds]
  const result = await compareAndWriteState((current) => {
    if (!current) return 'abort'
    return null
  })
  if (result !== 'ok') return null
  setMemoryState(null)
  void notifyEstopChanged()
  return { ...before, heldSessionIds }
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
