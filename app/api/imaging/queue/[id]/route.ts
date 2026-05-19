import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { getAdminFromRequest } from '@/lib/imaging-admin-auth'
import { authorizeImagingSession } from '@/lib/imaging-session-access'
import { getCurrentUser } from '@/lib/member-auth'
import {
  imagingCorsOptions,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import { boardRemove, getBoardEntry } from '@/lib/imaging-session-board'
import { removePreviewImage } from '@/lib/imaging-preview-store'
import {
  deleteRequestById,
  getRequestById,
  toPublicImagingRequest,
  updatePendingRequestById,
  updateStatus,
  type CreateImagingInput,
  type ImagingRequestStatus,
} from '@/lib/imaging-queue-store'
import { applyPendingProjectQueueEdit, deleteProjectById } from '@/lib/imaging-project-store'
import { planAndScheduleProjectTonight } from '@/lib/imaging-project-planner'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { getTonightWeatherPermittedIntervals } from '@/lib/tonight-weather-gate'
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

const allowed: ImagingRequestStatus[] = ['in_progress', 'completed', 'failed']

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400)
  }

  const status = (body as { status?: unknown }).status
  if (typeof status !== 'string' || !allowed.includes(status as ImagingRequestStatus)) {
    return withImagingCors(
      { ok: false as const, error: `status must be one of: ${allowed.join(', ')}` },
      400
    )
  }

  const result = await updateStatus(id, status as ImagingRequestStatus)
  if ('error' in result) {
    const code = result.error === 'Not found' ? 404 : 400
    return withImagingCors({ ok: false as const, error: result.error }, code)
  }

  void appendAuditLog({
    kind: 'queue.status',
    message: `Session ${id} status → ${status} (${result.target}).`,
    detail: { id, status, target: result.target },
  })

  return withImagingCors({ ok: true as const, request: toPublicImagingRequest(result) })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  const credential = request.headers.get('x-edit-credential')?.trim() || null
  const auth = await authorizeImagingSession(request, id, credential)
  if (!auth.ok) {
    return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400)
  }
  const b = body as Record<string, unknown>
  const user = await getCurrentUser(request)
  const parsedFilterPlans = Array.isArray(b.filterPlans)
    ? b.filterPlans
        .map((x) => {
          if (!x || typeof x !== 'object') return null
          const rec = x as Record<string, unknown>
          return {
            filterName: typeof rec.filterName === 'string' ? rec.filterName : '',
            exposureSeconds: rec.exposureSeconds as number | string,
            count: rec.count as number | string,
          }
        })
        .filter((x): x is { filterName: string; exposureSeconds: number | string; count: number | string } => x !== null)
    : undefined
  const firstPlan = parsedFilterPlans && parsedFilterPlans.length > 0 ? parsedFilterPlans[0] : null

  const payload: CreateImagingInput = {
    target: typeof b.target === 'string' ? b.target : b.target == null ? null : String(b.target),
    raHours: b.raHours as CreateImagingInput['raHours'],
    decDeg: b.decDeg as CreateImagingInput['decDeg'],
    filter:
      typeof b.filter === 'string'
        ? b.filter
        : firstPlan
          ? firstPlan.filterName
          : b.filter == null
            ? null
            : String(b.filter),
    exposureSeconds:
      b.exposureSeconds != null ? (b.exposureSeconds as CreateImagingInput['exposureSeconds']) : firstPlan ? firstPlan.exposureSeconds : '',
    count: b.count != null ? (b.count as CreateImagingInput['count']) : firstPlan ? firstPlan.count : '',
    sessionPassword: typeof b.sessionPassword === 'string' ? b.sessionPassword : '',
    outputMode:
      b.outputMode === 'stacked_master'
        ? 'stacked_master'
        : b.outputMode === 'none'
          ? 'none'
          : 'raw_zip',
    filterPlans: parsedFilterPlans,
    firstName: user
      ? user.firstName.trim() || null
      : typeof b.firstName === 'string'
        ? b.firstName
        : b.firstName == null
          ? null
          : String(b.firstName),
    lastName: user
      ? user.lastName.trim() || null
      : typeof b.lastName === 'string'
        ? b.lastName
        : b.lastName == null
          ? null
          : String(b.lastName),
    email: user
      ? user.email
      : typeof b.email === 'string'
        ? b.email
        : b.email == null
          ? null
          : String(b.email),
    sequenceTemplate: b.sessionType === 'variable_star' ? 'variable_star' : 'dso',
    estimatedDurationSeconds:
      typeof b.estimatedDurationSeconds === 'number' && Number.isFinite(b.estimatedDurationSeconds)
        ? b.estimatedDurationSeconds
        : undefined,
  }

  const updated = await updatePendingRequestById(id, payload)
  if ('error' in updated) {
    const status = typeof updated.status === 'number' ? updated.status : updated.error === 'Not found' ? 404 : 400
    return withImagingCors({ ok: false as const, error: updated.error }, status)
  }

  if (updated.projectMode && updated.filterPlans?.length) {
    const projectSync = await applyPendingProjectQueueEdit(id, {
      target: updated.target,
      raHours: updated.raHours!,
      decDeg: updated.decDeg!,
      outputMode: updated.outputMode ?? 'raw_zip',
      filterPlans: updated.filterPlans,
      estimatedDurationSeconds: updated.estimatedDurationSeconds ?? 0,
      firstName: updated.firstName ?? null,
      lastName: updated.lastName ?? null,
      email: updated.email ?? null,
      ...(updated.sessionPasswordHash ? { sessionPasswordHash: updated.sessionPasswordHash } : {}),
    })
    if ('error' in projectSync) {
      return withImagingCors({ ok: false as const, error: projectSync.error }, 400)
    }
    const weatherIntervals = await getTonightWeatherPermittedIntervals()
    if (weatherIntervals.status === 'ok') {
      const now = new Date()
      const window = getTonightSchedulingWindow(now)
      const nowMs = now.getTime()
      await planAndScheduleProjectTonight(
        id,
        [
          {
            startMs: Math.max(nowMs, window.nauticalDuskUtc.getTime()),
            endMs: window.nauticalDawnUtc.getTime(),
          },
        ],
        weatherIntervals.permittedIntervals,
        now
      )
    }
  }

  void appendAuditLog({
    kind: 'queue.edited',
    message: `Pending session edited: ${updated.target} (${updated.id}).`,
    detail: { id: updated.id, target: updated.target, status: updated.status },
  })
  return withImagingCors({ ok: true as const, request: toPublicImagingRequest(updated) })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  }

  const inQueue = await getRequestById(id)
  const onBoard = await getBoardEntry(id)
  if (!inQueue && !onBoard) {
    return withImagingCors({ ok: false as const, error: 'Not found' }, 404)
  }

  const credential = request.headers.get('x-delete-credential')?.trim() || null
  const auth = await authorizeImagingSession(request, id, credential)
  if (!auth.ok) {
    return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
  }
  const adminUser = await getAdminFromRequest(request)

  await deleteRequestById(id)
  await boardRemove(id)
  await deleteR2ObjectForQueueId(id)
  await removePreviewImage(id)
  const projectRecordRemoved = await deleteProjectById(id)

  void appendAuditLog({
    kind: 'queue.deleted',
    message: `${adminUser ? 'Admin manual delete' : 'User manual delete'} for imaging session ${id}.`,
    detail: {
      id,
      via: adminUser ? 'admin_account' : 'session_owner',
      source: adminUser ? 'admin_manual' : 'user_manual',
      ...(projectRecordRemoved ? { projectRecordRemoved: true } : {}),
    },
  })

  return withImagingCors({ ok: true as const })
}
