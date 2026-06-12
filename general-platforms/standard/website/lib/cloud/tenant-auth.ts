import type { NextRequest } from 'next/server'
import { loadTenantSecret } from '@/lib/cloud/tenant-registry'

function parseTenantSecretsFromEnv(): Record<string, string> {
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

export function personalTenantSecretFromEnv(tenantId: string): string | undefined {
  return parseTenantSecretsFromEnv()[tenantId]
}

export async function personalTenantSecret(tenantId: string): Promise<string | undefined> {
  const fromEnv = personalTenantSecretFromEnv(tenantId)
  if (fromEnv) return fromEnv
  return loadTenantSecret(tenantId)
}

export async function personalTenantAuthorized(
  tenantId: string,
  request: NextRequest
): Promise<boolean> {
  const expected = await personalTenantSecret(tenantId)
  if (!expected) return false
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return token === expected
}

export async function personalTenantKnown(tenantId: string): Promise<boolean> {
  return Boolean(await personalTenantSecret(tenantId))
}
