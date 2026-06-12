import type { NextRequest } from 'next/server'

function parseTenantSecrets(): Record<string, string> {
  const raw = process.env.PERSONAL_TENANT_SECRETS?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim()) out[key] = value.trim()
      }
      if (Object.keys(out).length > 0) return out
    } catch {
      /* fall through */
    }
  }
  return {
    'dev-local': process.env.PERSONAL_DEV_TENANT_SECRET?.trim() || 'dev-local-secret',
  }
}

export function personalTenantSecret(tenantId: string): string | undefined {
  return parseTenantSecrets()[tenantId]
}

export function personalTenantAuthorized(tenantId: string, request: NextRequest): boolean {
  const expected = personalTenantSecret(tenantId)
  if (!expected) return false
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return token === expected
}
