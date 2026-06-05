import type { NextRequest } from 'next/server'
import { logMissingProductionSecret, observatorySecretConfigured } from '@/lib/production-secrets'

export function cronAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim()
  if (!expected) {
    if (!observatorySecretConfigured(expected)) {
      logMissingProductionSecret('CRON_SECRET')
      return false
    }
    return true
  }
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${expected}`
}
