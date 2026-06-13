import { randomUUID } from 'node:crypto'
import { runWithTenantImaging } from '@/lib/cloud/personal-imaging/ctx'
import { deleteSessionById, getObservatoryState, listSessions, sessionToPublicJson, setObservatoryPatch, touchAgentPulse } from '@/lib/cloud/personal-imaging/db'
import { appendAuditLog } from '@/lib/cloud/personal-imaging/db'
import { getEmergencyStopPublicState, armEmergencyStop } from '@/lib/cloud/personal-imaging/estop-sync'
import { handleNinaSequenceGet, handleSessionProgressPost } from '@/lib/imaging/delivery'
import { createQueueSession, sessionToPublic, type QueueCreateInput } from '@/lib/imaging/queue-service'
import { reconcilePendingScheduleStatus } from '@/lib/imaging/reconcile'
import { emitAgentWakePollSequence } from '@/lib/imaging/live-bus'

export type { QueueCreateInput }

export function parseQueueBody(body: Record<string, unknown>): QueueCreateInput {
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const filterPlansRaw = body.filterPlans
  const filterPlans = Array.isArray(filterPlansRaw)
    ? filterPlansRaw
        .map((p) => {
          if (!p || typeof p !== 'object') return null
          const rec = p as Record<string, unknown>
          return {
            filterName: String(rec.filterName ?? ''),
            exposureSeconds: Number(rec.exposureSeconds),
            count: Number(rec.count),
          }
        })
        .filter(
          (p): p is { filterName: string; exposureSeconds: number; count: number } =>
            p != null && Boolean(p.filterName) && Number.isFinite(p.exposureSeconds) && Number.isFinite(p.count)
        )
    : []

  return {
    target,
    requestName: typeof body.requestName === 'string' ? body.requestName : target,
    sessionType: body.sessionType === 'variable_star' ? 'variable_star' : 'dso',
    whenClosedBehavior: typeof body.whenClosedBehavior === 'string' ? body.whenClosedBehavior : undefined,
    outputMode: typeof body.outputMode === 'string' ? body.outputMode : 'none',
    outputModeRequested:
      typeof body.outputModeRequested === 'string' ? body.outputModeRequested : undefined,
    cameraCoolingTempC: typeof body.cameraCoolingTempC === 'number' ? body.cameraCoolingTempC : undefined,
    projectMode: body.projectMode === true,
    raHours: typeof body.raHours === 'number' ? body.raHours : null,
    decDeg: typeof body.decDeg === 'number' ? body.decDeg : null,
    filter: typeof body.filter === 'string' ? body.filter : null,
    exposureSeconds: typeof body.exposureSeconds === 'number' ? body.exposureSeconds : null,
    count: typeof body.count === 'number' ? body.count : null,
    filterPlans,
    estimatedDurationSeconds:
      typeof body.estimatedDurationSeconds === 'number' ? body.estimatedDurationSeconds : null,
    variableStarBlockHours:
      typeof body.variableStarBlockHours === 'number' ? body.variableStarBlockHours : null,
    catalogQuery: typeof body.catalogQuery === 'string' ? body.catalogQuery : null,
    observatoryLat: typeof body.observatoryLat === 'number' ? body.observatoryLat : null,
    observatoryLon: typeof body.observatoryLon === 'number' ? body.observatoryLon : null,
    observatoryElevationM: typeof body.observatoryElevationM === 'number' ? body.observatoryElevationM : null,
  }
}

export async function imagingListSessions(tenantId: string) {
  return runWithTenantImaging(tenantId, async () => {
    await reconcilePendingScheduleStatus()
    return listSessions().map(sessionToPublicJson)
  })
}

export async function imagingCreateSession(tenantId: string, body: QueueCreateInput) {
  return runWithTenantImaging(tenantId, async () => {
    const session = await createQueueSession(body, randomUUID(), tenantId)
    return sessionToPublic(session)
  })
}

export async function imagingDeleteSession(tenantId: string, sessionId: string) {
  return runWithTenantImaging(tenantId, () => {
    const ok = deleteSessionById(sessionId)
    if (ok) {
      appendAuditLog({
        kind: 'session.deleted',
        message: `Session deleted: ${sessionId}`,
        detail: { id: sessionId },
      })
      emitAgentWakePollSequence(tenantId)
    }
    return ok
  })
}

export async function imagingReconcile(tenantId: string) {
  return runWithTenantImaging(tenantId, () => reconcilePendingScheduleStatus())
}

export async function imagingNinaSequence(tenantId: string) {
  return runWithTenantImaging(tenantId, () => handleNinaSequenceGet(tenantId))
}

export async function imagingSessionProgress(tenantId: string, detail: Record<string, unknown>) {
  return runWithTenantImaging(tenantId, () => handleSessionProgressPost(detail))
}

export async function imagingAgentPulse(tenantId: string, ninaRunning: boolean) {
  return runWithTenantImaging(tenantId, () => {
    touchAgentPulse(ninaRunning)
    return getObservatoryState()
  })
}

export async function imagingGetObservatory(tenantId: string) {
  return runWithTenantImaging(tenantId, () => getObservatoryState())
}

export async function imagingPatchObservatory(
  tenantId: string,
  patch: { mode?: 'manual' | 'auto'; status?: string }
) {
  return runWithTenantImaging(tenantId, () => {
    setObservatoryPatch({
      mode: patch.mode,
      status: patch.status as Parameters<typeof setObservatoryPatch>[0]['status'],
    })
    return getObservatoryState()
  })
}

export async function imagingEmergencyStopPublic(tenantId: string) {
  return runWithTenantImaging(tenantId, () => getEmergencyStopPublicState())
}

export async function imagingArmEmergencyStop(tenantId: string, requestedBy?: string) {
  return runWithTenantImaging(tenantId, () => {
    armEmergencyStop(requestedBy)
    emitAgentWakePollSequence(tenantId)
    return getEmergencyStopPublicState()
  })
}
