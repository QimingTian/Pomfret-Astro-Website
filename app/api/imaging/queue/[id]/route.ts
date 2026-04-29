import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import {
  imagingCorsOptions,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import { validateSessionPassword } from '@/lib/imaging-session-access'
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
import { deleteR2ObjectForQueueId } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

const allowed: ImagingRequestStatus[] = ['claimed', 'completed', 'failed']

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
  const credential = (
    request.headers.get('x-edit-credential') ??
    request.headers.get('x-admin-password') ??
    ''
  ).trim()
  if (!credential) {
    return withImagingCors({ ok: false as const, error: 'Session/Admin password required' }, 401)
  }
  const isAdmin = isImagingAdminPassword(credential)
  if (!isAdmin) {
    const auth = await validateSessionPassword(id, credential)
    if (!auth.ok) {
      return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
    }
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
    firstName: typeof b.firstName === 'string' ? b.firstName : b.firstName == null ? null : String(b.firstName),
    lastName: typeof b.lastName === 'string' ? b.lastName : b.lastName == null ? null : String(b.lastName),
    email: typeof b.email === 'string' ? b.email : b.email == null ? null : String(b.email),
    sequenceTemplate: b.sessionType === 'variable_star' ? 'variable_star' : 'dso',
  }

  const updated = await updatePendingRequestById(id, payload)
  if ('error' in updated) {
    const status = typeof updated.status === 'number' ? updated.status : updated.error === 'Not found' ? 404 : 400
    return withImagingCors({ ok: false as const, error: updated.error }, status)
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

  const credential = (
    request.headers.get('x-delete-credential') ??
    request.headers.get('x-admin-password') ??
    ''
  ).trim()
  if (!credential) {
    return withImagingCors({ ok: false as const, error: 'Password required' }, 401)
  }

  const isAdmin = isImagingAdminPassword(credential)
  if (!isAdmin) {
    const auth = await validateSessionPassword(id, credential)
    if (!auth.ok) {
      return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
    }
  }

  await deleteRequestById(id)
  await boardRemove(id)
  await deleteR2ObjectForQueueId(id)
  await removePreviewImage(id)

  void appendAuditLog({
    kind: 'queue.deleted',
    message: `${isAdmin ? 'Admin manual delete' : 'User manual delete'} for imaging session ${id}.`,
    detail: {
      id,
      via: isAdmin ? 'admin_password' : 'session_password',
      source: isAdmin ? 'admin_manual' : 'user_manual',
    },
  })

  return withImagingCors({ ok: true as const })
}
