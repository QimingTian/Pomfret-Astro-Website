import { NextRequest } from 'next/server'
import { requireImagingAdmin, formatImagingAdminActor } from '@/lib/imaging-admin-auth'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  clearEmergencyStopAfterManualUnlock,
  isEmergencyStopBlocking,
  isEmergencyStopStopped,
  isEmergencyStopStopping,
  shouldClearEmergencyStopOnObservatoryPatch,
  emergencyStopAuditDetailFromState,
  emergencyStopTriggeredBySuffix,
} from '@/lib/imaging-emergency-stop'
import { releaseEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import {
  getObservatoryMode,
  getObservatoryStatus,
  setObservatoryMode,
  setObservatoryStatus,
  type ObservatoryMode,
  type ObservatoryStatus,
} from '@/lib/observatory-status-store'

export const runtime = 'nodejs'

const allowedStatuses: ObservatoryStatus[] = [
  'ready',
  'busy_in_use',
  'disconnected',
  'closed_weather_not_permitted',
  'closed_daytime',
  'closed_observatory_maintenance',
]
const allowedModes: ObservatoryMode[] = ['manual', 'auto']

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET() {
  const mode = await getObservatoryMode()
  const status = await getObservatoryStatus()
  return withImagingCors({ ok: true as const, mode, status })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireImagingAdmin(request)
  if (!admin.ok) {
    return withImagingCors({ ok: false as const, error: admin.error }, admin.status)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }
  const mode = (body as { mode?: unknown })?.mode
  const status = (body as { status?: unknown })?.status

  if (mode !== undefined) {
    if (typeof mode !== 'string' || !allowedModes.includes(mode as ObservatoryMode)) {
      return withImagingCors(
        { ok: false as const, error: `mode must be one of: ${allowedModes.join(', ')}` },
        400
      )
    }
    await setObservatoryMode(mode as ObservatoryMode)
  }

  if (status !== undefined) {
    if (typeof status !== 'string' || !allowedStatuses.includes(status as ObservatoryStatus)) {
      return withImagingCors(
        { ok: false as const, error: `status must be one of: ${allowedStatuses.join(', ')}` },
        400
      )
    }
    await setObservatoryStatus(status as ObservatoryStatus)
  }

  const nextMode = await getObservatoryMode()
  const nextStatus = await getObservatoryStatus()

  const patchTouchesObservatory = mode !== undefined || status !== undefined
  const shouldClearStopped =
    (await isEmergencyStopStopped()) &&
    shouldClearEmergencyStopOnObservatoryPatch({
      mode: typeof mode === 'string' ? (mode as ObservatoryMode) : undefined,
      status: typeof status === 'string' ? (status as ObservatoryStatus) : undefined,
      currentMode: nextMode,
      currentStatus: nextStatus,
    })
  const shouldClearStopping =
    (await isEmergencyStopStopping()) && patchTouchesObservatory

  if ((shouldClearStopped || shouldClearStopping) && (await isEmergencyStopBlocking())) {
    const cleared = await clearEmergencyStopAfterManualUnlock()
    if (cleared?.heldSessionIds.length) {
      await releaseEmergencyStopHolds(cleared.heldSessionIds)
    }
    void appendAuditLog({
      kind: 'emergency_stop',
      message: shouldClearStopping
        ? `Emergency STOP aborted (was STOPPING) after admin observatory update${emergencyStopTriggeredBySuffix(cleared ?? {})}.`
        : `Emergency STOP cleared after manual observatory mode/status change${emergencyStopTriggeredBySuffix(cleared ?? {})}.`,
      detail: emergencyStopAuditDetailFromState({
        queueId: cleared?.queueId ?? 'unknown',
        requestedAt: cleared?.requestedAt,
        requestedBy: cleared?.requestedBy,
        requestedByUserId: cleared?.requestedByUserId,
        requestedByUsername: cleared?.requestedByUsername,
        requestedByEmail: cleared?.requestedByEmail,
        clearedBy: formatImagingAdminActor(admin.user),
        mode: nextMode,
        status: nextStatus,
        releasedHolds: cleared?.heldSessionIds ?? [],
        previousPhase: cleared?.phase ?? null,
      }),
    })
  }

  const parts: string[] = []
  if (mode !== undefined) parts.push(`mode → ${nextMode}`)
  if (status !== undefined) parts.push(`status → ${nextStatus}`)
  if (parts.length > 0) {
    void appendAuditLog({
      kind: 'observatory.patch',
      message: `Observatory updated (${parts.join(', ')})`,
      detail: { mode: nextMode, status: nextStatus },
    })
  }

  return withImagingCors({ ok: true as const, mode: nextMode, status: nextStatus })
}
