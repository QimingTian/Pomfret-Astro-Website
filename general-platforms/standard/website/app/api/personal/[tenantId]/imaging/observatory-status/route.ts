import { NextRequest } from 'next/server'
import { personalGetObservatory } from '@/lib/cloud/hub-store'
import { personalJson, personalOptions, requirePersonalTenant } from '@/lib/cloud/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const { mode, status } = await personalGetObservatory(tenantId)
  return personalJson({ ok: true, mode, status })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { mode?: string; status?: string }
  if (body.mode !== 'manual' && body.mode !== 'auto' && body.mode != null) {
    return personalJson({ ok: false, error: 'Invalid mode' }, 400)
  }
  const { personalPatchObservatory } = await import('@/lib/cloud/hub-store')
  const next = await personalPatchObservatory(tenantId, {
    mode: body.mode as 'manual' | 'auto' | undefined,
    status: body.status as Parameters<typeof personalPatchObservatory>[1]['status'],
  })
  return personalJson({ ok: true, ...next })
}
