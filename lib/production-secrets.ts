/** Production must have required secrets configured; dev may run without them. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function secretConfigured(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

/**
 * Returns true when the secret is available for auth checks.
 * In production, missing secrets fail closed (return false).
 */
export function productionSecretAvailable(value: string | undefined): boolean {
  if (!secretConfigured(value)) {
    if (isProductionRuntime()) return false
    return false
  }
  return true
}

/** When unset in production, observatory/cron routes must reject requests. */
export function observatorySecretConfigured(value: string | undefined): boolean {
  if (secretConfigured(value)) return true
  if (isProductionRuntime()) {
    return false
  }
  // Dev: permissive when unset (local NINA testing).
  return true
}

const loggedMissing = new Set<string>()

export function logMissingProductionSecret(name: string): void {
  if (!isProductionRuntime()) return
  if (loggedMissing.has(name)) return
  loggedMissing.add(name)
  console.error(`[security] Missing required production env: ${name}`)
}
