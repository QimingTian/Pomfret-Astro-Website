import { NextRequest } from 'next/server'
import { personalDeleteSession } from '@/lib/cloud/hub-store'
import { personalAppendAuditLog } from '@/lib/cloud/personal-audit-log'
import { personalJson, personalOptions, requirePersonalTenant } from '@/lib/cloud/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string; sessionId: string }> }
) {
  const { tenantId, sessionId } = await context.params
  const denied = await requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const id = sessionId.trim()
  if (!id) return personalJson({ ok: false, error: 'sessionId is required' }, 400)
  const deleted = await personalDeleteSession(tenantId, id)
  if (!deleted) return personalJson({ ok: false, error: 'Session not found' }, 404)
  void personalAppendAuditLog(tenantId, {
    kind: 'session.deleted',
    message: `Session deleted: ${id}`,
    detail: { id },
  })
  return personalJson({ ok: true })
}
