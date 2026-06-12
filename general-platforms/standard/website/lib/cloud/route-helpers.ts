import { NextRequest, NextResponse } from 'next/server'
import { personalTenantAuthorized, personalTenantKnown } from '@/lib/cloud/tenant-auth'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function personalOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export function personalUnauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
}

export function personalNotFoundTenant() {
  return NextResponse.json({ ok: false, error: 'Unknown tenant' }, { status: 404, headers: CORS_HEADERS })
}

export async function requirePersonalTenant(
  tenantId: string,
  request: NextRequest
): Promise<NextResponse | null> {
  if (!(await personalTenantKnown(tenantId))) return personalNotFoundTenant()
  if (!(await personalTenantAuthorized(tenantId, request))) return personalUnauthorized()
  return null
}

export function personalJson<T extends object>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}
