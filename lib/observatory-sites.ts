/**
 * Observatory geography and timezone.
 *
 * Pomfret is the only live site. Weather / maps historically used a slightly
 * different pin than horizon / altitude geometry — keep both so scheduling
 * numbers do not change.
 *
 * Queue, ESTOP, and agent KV stay global (unprefixed) until a later split.
 * `observatoryKvKey('pomfret', key)` must equal `key`.
 */

export const DEFAULT_OBSERVATORY_SITE_ID = 'pomfret' as const

export type ObservatorySiteId = typeof DEFAULT_OBSERVATORY_SITE_ID

export type ObservatorySite = {
  id: ObservatorySiteId
  name: string
  timezone: string
  elevationMeters: number
  /** Open-Meteo, LibreWXR, Plan Stellarium (historical weather pin). */
  weatherLat: number
  weatherLon: number
  /** LST / altitude / 7Timer / storm ring (historical DMS). */
  observerLatDeg: number
  observerLonDeg: number
}

export const POMFRET_SITE: ObservatorySite = {
  id: 'pomfret',
  name: 'Pomfret',
  timezone: 'America/New_York',
  elevationMeters: 150,
  weatherLat: 41.9159,
  weatherLon: -71.9626,
  observerLatDeg: 41 + 53 / 60 + 10 / 3600,
  observerLonDeg: -(71 + 57 / 60 + 54 / 3600),
}

const SITES: Record<ObservatorySiteId, ObservatorySite> = {
  pomfret: POMFRET_SITE,
}

export function isObservatorySiteId(value: string): value is ObservatorySiteId {
  return value === DEFAULT_OBSERVATORY_SITE_ID
}

/** Missing or unknown `site` → Pomfret (existing URLs unchanged). */
export function resolveObservatorySite(id?: string | null): ObservatorySite {
  if (id && isObservatorySiteId(id)) return SITES[id]
  return POMFRET_SITE
}

export function observatorySiteFromSearchParams(searchParams: URLSearchParams): ObservatorySite {
  return resolveObservatorySite(searchParams.get('site'))
}

/**
 * Imaging queue / ESTOP / agent remain Pomfret-only until KV is namespaced.
 * `site` on those routes is accepted and ignored.
 */
export function liveImagingObservatorySite(): ObservatorySite {
  return POMFRET_SITE
}

export function observatoryKvKey(siteId: string, key: string): string {
  if (!siteId || siteId === DEFAULT_OBSERVATORY_SITE_ID) return key
  return `site:${siteId}:${key}`
}
