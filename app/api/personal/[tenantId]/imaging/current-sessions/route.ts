import { NextRequest } from 'next/server'
import { personalListSessions, personalSessionToPublicJson } from '@/lib/personal/hub-store'
import { personalJson, personalOptions, requirePersonalTenant } from '@/lib/personal/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const denied = requirePersonalTenant(tenantId, request)
  if (denied) return denied
  const sessions = (await personalListSessions(tenantId)).map(personalSessionToPublicJson)
  return personalJson({ ok: true, sessions })
}
