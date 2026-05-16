import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import {
  addAdminClosedWindow,
  listAdminClosedWindows,
  removeAdminClosedWindow,
} from '@/lib/admin-closed-window-store'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { listAll } from '@/lib/imaging-queue-store'
import { listBoardEntries } from '@/lib/imaging-session-board'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET() {
  const windows = await listAdminClosedWindows()
  return withImagingCors({ ok: true as const, windows })
}

export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password')
  if (!isImagingAdminPassword(password)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const startIso = typeof b.startIso === 'string' ? b.startIso : ''
  const endIso = typeof b.endIso === 'string' ? b.endIso : ''
  const description = typeof b.description === 'string' ? b.description : ''
  const startMs = Date.parse(startIso)
  const endMs = Date.parse(endIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return withImagingCors({ ok: false as const, error: 'Invalid time range' }, 400)
  }

  const [queueRows, boardRows] = await Promise.all([listAll(), listBoardEntries()])
  const inProgressById = new Map<
    string,
    {
      id: string
      target: string
      startMs: number
      endMs: number
      estimatedDurationSeconds: number
      source: 'queue' | 'board'
    }
  >()

  for (const q of queueRows) {
    if (q.status !== 'in_progress') continue
    const estSec =
      typeof q.estimatedDurationSeconds === 'number' && Number.isFinite(q.estimatedDurationSeconds)
        ? q.estimatedDurationSeconds
        : null
    const startedAtMs = Date.parse(q.updatedAt)
    if (!estSec || estSec <= 0 || !Number.isFinite(startedAtMs)) continue
    inProgressById.set(q.id, {
      id: q.id,
      target: q.target,
      startMs: startedAtMs,
      endMs: startedAtMs + estSec * 1000,
      estimatedDurationSeconds: estSec,
      source: 'queue',
    })
  }

  for (const bRow of boardRows) {
    if (bRow.status !== 'in_progress') continue
    if (inProgressById.has(bRow.id)) continue
    const estSec =
      typeof bRow.estimatedDurationSeconds === 'number' && Number.isFinite(bRow.estimatedDurationSeconds)
        ? bRow.estimatedDurationSeconds
        : null
    const startedAtMs = Date.parse(bRow.updatedAt)
    if (!estSec || estSec <= 0 || !Number.isFinite(startedAtMs)) continue
    inProgressById.set(bRow.id, {
      id: bRow.id,
      target: bRow.target,
      startMs: startedAtMs,
      endMs: startedAtMs + estSec * 1000,
      estimatedDurationSeconds: estSec,
      source: 'board',
    })
  }

  for (const row of Array.from(inProgressById.values())) {
    const overlap = Math.max(startMs, row.startMs) < Math.min(endMs, row.endMs)
    if (!overlap) continue
    return withImagingCors(
      {
        ok: false as const,
        error:
          `Cannot add this closed window: it overlaps with in-progress session "${row.target}" (${row.id}). ` +
          `Wait for it to finish before adding this window.`,
      },
      409
    )
  }

  const created = await addAdminClosedWindow(startIso, endIso, description)
  if ('error' in created) {
    return withImagingCors({ ok: false as const, error: created.error }, 400)
  }
  await reconcilePendingScheduleStatus()
  void appendAuditLog({
    kind: 'schedule_control.add',
    message: `Admin scheduled closed window ${created.startIso} -> ${created.endIso}`,
    detail: {
      id: created.id,
      startIso: created.startIso,
      endIso: created.endIso,
      description: created.description ?? null,
    },
  })
  return withImagingCors({ ok: true as const, window: created })
}

export async function DELETE(request: NextRequest) {
  const password = request.headers.get('x-admin-password')
  if (!isImagingAdminPassword(password)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }
  const requestUrl = new URL(request.url)
  const id = requestUrl.searchParams.get('id') ?? ''
  if (!id) return withImagingCors({ ok: false as const, error: 'id is required' }, 400)
  const ok = await removeAdminClosedWindow(id)
  if (!ok) return withImagingCors({ ok: false as const, error: 'Not found' }, 404)
  await reconcilePendingScheduleStatus()
  void appendAuditLog({
    kind: 'schedule_control.remove',
    message: `Admin removed closed window ${id}`,
    detail: { id },
  })
  return withImagingCors({ ok: true as const })
}

