import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import {
  addAdminClosedWindow,
  listAdminClosedWindows,
  removeAdminClosedWindow,
} from '@/lib/admin-closed-window-store'
import { appendAuditLog } from '@/lib/imaging-audit-log'

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
  const created = await addAdminClosedWindow(startIso, endIso, description)
  if ('error' in created) {
    return withImagingCors({ ok: false as const, error: created.error }, 400)
  }
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
  void appendAuditLog({
    kind: 'schedule_control.remove',
    message: `Admin removed closed window ${id}`,
    detail: { id },
  })
  return withImagingCors({ ok: true as const })
}

