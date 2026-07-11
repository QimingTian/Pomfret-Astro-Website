import { NextRequest } from 'next/server'
import { logMissingProductionSecret, observatorySecretConfigured } from '@/lib/production-secrets'

/**
 * POST requires shared secret (NINA plugin → server).
 * When `NINA_MOUNT_TELEMETRY_SECRET` is set, POST requires one of:
 * - `Authorization: Bearer <secret>`
 * - Header `x-nina-mount-telemetry-secret: <secret>`
 * - Optional Basic: set `NINA_MOUNT_TELEMETRY_BASIC_PASSWORD` (and optional `NINA_MOUNT_TELEMETRY_BASIC_USER`, default '')
 *
 * GET is intentionally open — the Remote dashboard polls without the plugin secret.
 */
function bearerSecret(): string | undefined {
  const p = process.env.NINA_MOUNT_TELEMETRY_SECRET
  return p && p.length > 0 ? p : undefined
}

function basicPassword(): string | undefined {
  const p = process.env.NINA_MOUNT_TELEMETRY_BASIC_PASSWORD
  return p && p.length > 0 ? p : undefined
}

function expectedBasicUser(): string {
  return process.env.NINA_MOUNT_TELEMETRY_BASIC_USER ?? ''
}

function parseBasicCredentials(authorization: string | null): { user: string; pass: string } | null {
  if (!authorization?.startsWith('Basic ')) return null
  try {
    const raw = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
    const colon = raw.indexOf(':')
    if (colon === -1) return { user: '', pass: raw }
    return { user: raw.slice(0, colon), pass: raw.slice(colon + 1) }
  } catch {
    return null
  }
}

export function mountTelemetryPostAuthorized(request: NextRequest): boolean {
  const secret = bearerSecret()
  const basicPass = basicPassword()

  if (!secret && !basicPass) {
    if (!observatorySecretConfigured(undefined)) {
      logMissingProductionSecret('NINA_MOUNT_TELEMETRY_SECRET or NINA_MOUNT_TELEMETRY_BASIC_PASSWORD')
      return false
    }
    return true
  }

  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth === `Bearer ${secret}`) return true
    if (request.headers.get('x-nina-mount-telemetry-secret') === secret) return true
  }

  if (basicPass) {
    const basic = parseBasicCredentials(request.headers.get('authorization'))
    if (basic && basic.user === expectedBasicUser() && basic.pass === basicPass) return true
  }

  return false
}

/** @deprecated Use mountTelemetryPostAuthorized — GET no longer requires plugin secret. */
export function mountTelemetryAuthorized(request: NextRequest): boolean {
  return mountTelemetryPostAuthorized(request)
}
