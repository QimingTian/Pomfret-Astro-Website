import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendAuditLog, getObservatoryState, listSessions, patchSessionStatus, setObservatoryPatch } from '@/lib/cloud/personal-imaging/db'
import { getEstopState, getTenantId, setEstopState } from '@/lib/cloud/personal-imaging/ctx'
import type { PersonalEmergencyStopState } from '@/lib/cloud/personal-emergency-stop'
import type {
  PersonalEmergencyStopPublicPhase,
  PersonalEmergencyStopPublicState,
} from '@/lib/cloud/personal-emergency-stop'

const estopTemplate = JSON.parse(
  readFileSync(join(process.cwd(), 'EStop.json'), 'utf8')
) as Record<string, unknown>

export type EmergencyStopState = PersonalEmergencyStopState

function getState(): EmergencyStopState | null {
  return getEstopState()
}

function setState(state: EmergencyStopState | null): void {
  setEstopState(state)
}

function applyHoldsSync(): string[] {
  const sessions = listSessions()
  const held: string[] = []
  for (const session of sessions) {
    if (session.status === 'pending' || session.status === 'scheduled') {
      patchSessionStatus(session.id, 'on_hold')
      held.push(session.id)
    } else if (session.status === 'in_progress') {
      patchSessionStatus(session.id, 'failed')
    }
  }
  return held
}

export function getEmergencyStopPublicState(): PersonalEmergencyStopPublicState & { agentConnected: boolean } {
  const estopState = getState()
  const phase: PersonalEmergencyStopPublicPhase = estopState?.phase ?? 'idle'
  const agentConnected = getObservatoryState().status !== 'disconnected'
  const progress: PersonalEmergencyStopPublicState['progress'] = !estopState
    ? 0
    : estopState.phase === 'stopped'
      ? 100
      : estopState.deliveredAt
        ? 66
        : 33
  const label: PersonalEmergencyStopPublicState['label'] =
    phase === 'stopping' ? 'STOPPING' : phase === 'stopped' ? 'STOPPED' : 'ESTOP'
  return {
    agentConnected,
    phase,
    progress,
    label,
    queueId: estopState?.queueId ?? null,
    canArm: phase === 'idle' && agentConnected,
    blocking: phase === 'stopping' || phase === 'stopped',
    stopped: phase === 'stopped',
  }
}

export function armEmergencyStop(requestedBy?: string | null): EmergencyStopState {
  const estopState = getState()
  if (estopState?.phase === 'stopping' || estopState?.phase === 'stopped') {
    throw new Error('Emergency STOP is already active.')
  }
  const heldSessionIds = applyHoldsSync()
  const queueId = `estop-${Date.now()}`
  const next: EmergencyStopState = {
    phase: 'stopping',
    queueId,
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy?.trim() || null,
    heldSessionIds,
  }
  setState(next)
  appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP armed (${queueId})`,
    detail: { queueId, requestedBy: requestedBy?.trim() || null, heldSessionIds },
  })
  return next
}

export function isEmergencyStopStopping(): boolean {
  return getState()?.phase === 'stopping'
}

export function isEmergencyStopBlocking(): boolean {
  const phase = getState()?.phase
  return phase === 'stopping' || phase === 'stopped'
}

export function markEmergencyStopDelivered(queueId: string): boolean {
  const estopState = getState()
  if (!estopState || estopState.queueId !== queueId || estopState.phase !== 'stopping') return false
  if (estopState.deliveredAt) return false
  setState({ ...estopState, deliveredAt: new Date().toISOString() })
  return true
}

export function markEmergencyStopCompleted(queueId: string): boolean {
  const estopState = getState()
  if (!estopState || estopState.queueId !== queueId || estopState.phase !== 'stopping') return false
  setState({
    ...estopState,
    phase: 'stopped',
    completedAt: new Date().toISOString(),
  })
  setObservatoryPatch({ mode: 'manual', status: 'closed_observatory_maintenance' })
  appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP completed (${queueId}); observatory locked to manual Closed — Maintenance.`,
    detail: { queueId, event: 'completed' },
  })
  return true
}

function patchEstopHttpPost(root: Record<string, unknown>, tenantId: string, queueId: string): void {
  const base = (process.env.BOREAN_API_BASE_URL ?? 'https://www.boreanastro.com').replace(/\/$/, '')
  const progressUrl = `${base}/api/personal/${encodeURIComponent(tenantId)}/imaging/session-progress`
  const body = JSON.stringify({
    text: 'Dome Closed',
    queueId,
    BoreanAstro: { QueueId: queueId, SessionType: 'estop' },
  })

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const rec = node as Record<string, unknown>
    const type = rec.$type
    if (typeof type === 'string' && type.includes('HTTP.HttpClient')) {
      rec.HttpUri = progressUrl
      rec.HttpPostBody = body
      rec.HttpPostContentType = 'application/json'
      rec.HttpAuthUsername = ''
      rec.HttpAuthPassword = ''
    }
    for (const value of Object.values(rec)) walk(value)
  }

  walk(root)
}

export function estopSequenceJson(tenantId: string, queueId: string): string {
  const root = structuredClone(estopTemplate) as Record<string, unknown>
  root.Name = 'Emergency Stop'
  root.BoreanAstro = {
    QueueId: queueId,
    SessionType: 'estop',
    OutputMode: 'none',
  }
  patchEstopHttpPost(root, tenantId, queueId)
  return JSON.stringify(root, null, 2)
}

export function getEmergencyStopState(): EmergencyStopState | null {
  return getState()
}

export function isEstopQueueId(queueId: string): boolean {
  return queueId.startsWith('estop-')
}
