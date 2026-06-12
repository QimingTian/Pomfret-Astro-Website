import { NextRequest, NextResponse } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging/queue/auth'
import { personalTenantAuthorized } from '@/lib/personal/tenant-auth'

export function personalOptions() {
  return imagingCorsOptions()
}

export function personalUnauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export function personalNotFoundTenant() {
  return NextResponse.json({ ok: false, error: 'Unknown tenant' }, { status: 404 })
}

export function requirePersonalTenant(
  tenantId: string,
  request: NextRequest
): NextResponse | null {
  if (!personalTenantAuthorized(tenantId, request)) {
    return personalUnauthorized()
  }
  return null
}

export function personalJson<T extends object>(body: T, status = 200) {
  return withImagingCors(body, status)
}
