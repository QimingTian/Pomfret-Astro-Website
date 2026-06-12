import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import {
  personalInsertSession,
  personalSessionToPublicJson,
  type PersonalSessionOutputMode,
} from '@/lib/cloud/hub-store'
import { personalJson, personalOptions, requirePersonalTenant } from '@/lib/cloud/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  if (!target) {
    return personalJson({ ok: false, error: 'target is required' }, 400)
  }
  const outputModeRaw = typeof body.outputMode === 'string' ? body.outputMode : 'none'
  const outputMode: PersonalSessionOutputMode = outputModeRaw === 'raw_zip' ? 'raw_zip' : 'none'
  const session = await personalInsertSession(tenantId, {
    id: randomUUID(),
    target,
    outputMode,
    raHours: typeof body.raHours === 'number' ? body.raHours : null,
    decDeg: typeof body.decDeg === 'number' ? body.decDeg : null,
    filter: typeof body.filter === 'string' ? body.filter : null,
    exposureSeconds: typeof body.exposureSeconds === 'number' ? body.exposureSeconds : null,
    count: typeof body.count === 'number' ? body.count : null,
  })
  return personalJson({ ok: true, request: personalSessionToPublicJson(session) }, 201)
}
