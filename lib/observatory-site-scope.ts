/**
 * Request / UI selected observatory site.
 *
 * Browser-safe: no `node:*` imports (dashboard layout imports this via the site provider).
 * Server ALS is registered from `lib/observatory-site-als.ts` (API routes only).
 */

import {
  DEFAULT_OBSERVATORY_SITE_ID,
  observatoryKvKey,
  resolveObservatorySite,
  type ObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'

type AlsBridge = {
  getStore: () => ObservatorySiteId | undefined
  run: <T>(id: ObservatorySiteId, fn: () => T) => T
}

let alsBridge: AlsBridge | null = null
let clientSiteId: ObservatorySiteId = DEFAULT_OBSERVATORY_SITE_ID

/** Called once from server-only `observatory-site-als.ts`. */
export function registerObservatorySiteAls(bridge: AlsBridge): void {
  alsBridge = bridge
}

export function setClientObservatorySiteId(id: ObservatorySiteId): void {
  clientSiteId = id
}

export function currentObservatorySiteId(): ObservatorySiteId {
  const fromAls = alsBridge?.getStore()
  if (fromAls) return fromAls
  return clientSiteId
}

export function currentObservatorySite(): ObservatorySite {
  return resolveObservatorySite(currentObservatorySiteId())
}

export function withObservatorySite<T>(siteId: ObservatorySiteId, fn: () => T): T {
  if (alsBridge) return alsBridge.run(siteId, fn)
  const prev = clientSiteId
  clientSiteId = siteId
  try {
    return fn()
  } finally {
    clientSiteId = prev
  }
}

export async function withObservatorySiteAsync<T>(
  siteId: ObservatorySiteId,
  fn: () => Promise<T>
): Promise<T> {
  if (alsBridge) return alsBridge.run(siteId, fn)
  const prev = clientSiteId
  clientSiteId = siteId
  try {
    return await fn()
  } finally {
    clientSiteId = prev
  }
}

/** Redis / ops key namespaced for the current site (Pomfret unprefixed). */
export function scopedKvKey(baseKey: string): string {
  return observatoryKvKey(currentObservatorySiteId(), baseKey)
}
