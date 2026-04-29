import { NextRequest } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
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

const ADMIN_PASSWORD = '1894'
const allowedStatuses: ObservatoryStatus[] = [
  'ready',
  'busy_in_use',
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
  const password = request.headers.get('x-admin-password')
  if (password !== ADMIN_PASSWORD) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
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
