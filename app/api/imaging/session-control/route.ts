import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { requireImagingAdmin } from '@/lib/imaging-admin-auth'
import {
  adminDeleteSession,
  adminMarkSessionComplete,
  adminMarkSessionFailed,
  adminRunSessionControl,
  listSessionControlEntries,
} from '@/lib/imaging-session-control'
import { runImagingScheduleMaintenance } from '@/lib/imaging-session-maintenance'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const admin = await requireImagingAdmin(request)
  if (!admin.ok) {
    return withImagingCors({ ok: false as const, error: admin.error }, admin.status)
  }
  await runImagingScheduleMaintenance()
  const sessions = await listSessionControlEntries()
  return withImagingCors({ ok: true as const, sessions })
}

export async function POST(request: NextRequest) {
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
  if (!body || typeof body !== 'object') {
    return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400)
  }

  const b = body as Record<string, unknown>
  const action = typeof b.action === 'string' ? b.action : ''
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : ''
  if (!sessionId) {
    return withImagingCors({ ok: false as const, error: 'sessionId is required' }, 400)
  }

  let result: { ok: true } | { error: string }
  switch (action) {
    case 'complete':
      result = await adminMarkSessionComplete(sessionId)
      break
    case 'fail':
      result = await adminMarkSessionFailed(sessionId)
      break
    case 'delete':
      result = await adminDeleteSession(sessionId)
      break
    case 'run':
      result = await adminRunSessionControl(sessionId)
      break
    default:
      return withImagingCors(
        { ok: false as const, error: 'action must be complete, fail, delete, or run' },
        400
      )
  }

  if ('error' in result) {
    return withImagingCors({ ok: false as const, error: result.error }, 400)
  }
  const sessions = await listSessionControlEntries()
  return withImagingCors({ ok: true as const, sessions })
}
