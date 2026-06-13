import { kvGetJson, kvSetJson } from '@/lib/cloud/kv-rest'
import { personalGetObservatory, personalPatchObservatory } from '@/lib/cloud/hub-store'

export type PersonalEmergencyStopPhase = 'stopping' | 'stopped'
export type PersonalEmergencyStopPublicPhase = 'idle' | PersonalEmergencyStopPhase

export type PersonalEmergencyStopState = {
  phase: PersonalEmergencyStopPhase
  queueId: string
  requestedAt: string
  requestedBy?: string | null
  deliveredAt?: string | null
  completedAt?: string | null
  heldSessionIds: string[]
}

export type PersonalEmergencyStopPublicState = {
  phase: PersonalEmergencyStopPublicPhase
  progress: 0 | 33 | 66 | 100
  label: 'ESTOP' | 'STOPPING' | 'STOPPED'
  queueId: string | null
  canArm: boolean
  blocking: boolean
  stopped: boolean
}

const memory = new Map<string, PersonalEmergencyStopState | null>()

function kvKey(tenantId: string): string {
  return `personal-hub:${tenantId}:estop`
}

function normalizeState(raw: unknown): PersonalEmergencyStopState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const queueId = typeof r.queueId === 'string' ? r.queueId.trim() : ''
  if (!queueId) return null
  if (r.phase !== 'stopping' && r.phase !== 'stopped') return null
  const heldSessionIds = Array.isArray(r.heldSessionIds)
    ? r.heldSessionIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  return {
    phase: r.phase,
    queueId,
    requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : new Date().toISOString(),
    requestedBy: typeof r.requestedBy === 'string' ? r.requestedBy : null,
    deliveredAt: typeof r.deliveredAt === 'string' ? r.deliveredAt : null,
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
    heldSessionIds,
  }
}

async function readState(tenantId: string): Promise<PersonalEmergencyStopState | null> {
  if (memory.has(tenantId)) return memory.get(tenantId) ?? null
  const remote = await kvGetJson<unknown>(kvKey(tenantId))
  const normalized = normalizeState(remote)
  memory.set(tenantId, normalized)
  return normalized
}

async function writeState(tenantId: string, state: PersonalEmergencyStopState | null): Promise<void> {
  memory.set(tenantId, state)
  await kvSetJson(kvKey(tenantId), state ?? { phase: null, clearedAt: new Date().toISOString() })
}

function progressForState(state: PersonalEmergencyStopState | null): PersonalEmergencyStopPublicState['progress'] {
  if (!state) return 0
  if (state.phase === 'stopped') return 100
  if (state.deliveredAt) return 66
  return 33
}

function labelForPhase(phase: PersonalEmergencyStopPublicPhase): PersonalEmergencyStopPublicState['label'] {
  if (phase === 'stopping') return 'STOPPING'
  if (phase === 'stopped') return 'STOPPED'
  return 'ESTOP'
}

export function isPersonalEstopQueueId(queueId: string): boolean {
  return queueId.startsWith('estop-')
}

export async function isPersonalAgentConnected(tenantId: string): Promise<boolean> {
  const obs = await personalGetObservatory(tenantId)
  return obs.status !== 'disconnected'
}

export async function personalGetEmergencyStopPublicState(
  tenantId: string
): Promise<PersonalEmergencyStopPublicState & { agentConnected: boolean }> {
  const agentConnected = await isPersonalAgentConnected(tenantId)
  const state = await readState(tenantId)
  const phase: PersonalEmergencyStopPublicPhase = state?.phase ?? 'idle'
  return {
    agentConnected,
    phase,
    progress: progressForState(state),
    label: labelForPhase(phase),
    queueId: state?.queueId ?? null,
    canArm: phase === 'idle' && agentConnected,
    blocking: phase === 'stopping' || phase === 'stopped',
    stopped: phase === 'stopped',
  }
}

export async function personalIsEmergencyStopBlocking(tenantId: string): Promise<boolean> {
  const state = await readState(tenantId)
  return state?.phase === 'stopping' || state?.phase === 'stopped'
}

export async function personalArmEmergencyStop(
  tenantId: string,
  requestedBy?: string | null
): Promise<PersonalEmergencyStopState> {
  const existing = await readState(tenantId)
  if (existing?.phase === 'stopping' || existing?.phase === 'stopped') {
    throw new Error('Emergency STOP is already active.')
  }
  const { personalApplyEmergencyStopHolds } = await import('@/lib/cloud/hub-store')
  const heldSessionIds = await personalApplyEmergencyStopHolds(tenantId)
  const queueId = `estop-${Date.now()}`
  const state: PersonalEmergencyStopState = {
    phase: 'stopping',
    queueId,
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy?.trim() || null,
    heldSessionIds,
  }
  await writeState(tenantId, state)
  const { personalAppendAuditLog } = await import('@/lib/cloud/personal-audit-log')
  void personalAppendAuditLog(tenantId, {
    kind: 'emergency_stop',
    message: `Emergency STOP armed (${queueId})`,
    detail: { queueId, requestedBy: requestedBy?.trim() || null, heldSessionIds },
  })
  return state
}

export async function personalMarkEmergencyStopDelivered(
  tenantId: string,
  queueId: string
): Promise<boolean> {
  const state = await readState(tenantId)
  if (!state || state.queueId !== queueId || state.phase !== 'stopping' || state.deliveredAt) return false
  await writeState(tenantId, { ...state, deliveredAt: new Date().toISOString() })
  return true
}

export async function personalMarkEmergencyStopCompleted(
  tenantId: string,
  queueId: string
): Promise<boolean> {
  const state = await readState(tenantId)
  if (!state || state.queueId !== queueId || state.phase !== 'stopping') return false
  await writeState(tenantId, {
    ...state,
    phase: 'stopped',
    completedAt: new Date().toISOString(),
  })
  await personalPatchObservatory(tenantId, {
    mode: 'manual',
    status: 'closed_observatory_maintenance',
  })
  void (async () => {
    const { personalAppendAuditLog } = await import('@/lib/cloud/personal-audit-log')
    await personalAppendAuditLog(tenantId, {
      kind: 'emergency_stop',
      message: `Emergency STOP completed (${queueId}); observatory locked to manual Closed — Maintenance.`,
      detail: { queueId, event: 'completed' },
    })
  })()
  return true
}

export async function personalGetEmergencyStopState(
  tenantId: string
): Promise<PersonalEmergencyStopState | null> {
  return readState(tenantId)
}

export async function personalIsEmergencyStopStopping(tenantId: string): Promise<boolean> {
  const state = await readState(tenantId)
  return state?.phase === 'stopping'
}
