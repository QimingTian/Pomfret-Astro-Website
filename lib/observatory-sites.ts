/**
 * Observatory geography and timezone.
 *
 * Pomfret Redis imaging keys stay unprefixed: `observatoryKvKey('pomfret', key) === key`.
 * Other sites use `site:<id>:<key>`.
 */

export const DEFAULT_OBSERVATORY_SITE_ID = 'pomfret' as const

export type ObservatorySiteId = 'pomfret' | 'cygnus'

export type ObservatorySite = {
  id: ObservatorySiteId
  name: string
  timezone: string
  elevationMeters: number
  /** Open-Meteo, LibreWXR, Plan Stellarium (weather pin). */
  weatherLat: number
  weatherLon: number
  /** LST / altitude / 7Timer / storm ring. */
  observerLatDeg: number
  observerLonDeg: number
  /**
   * Tonight's Schedule strip: observatory-local start hour (0–23) through next calendar
   * day's end hour. Pomfret keeps historical 16→08; Cygnus uses 15→10 so winter sunrise
   * (~08:45–09:00) and early sunset (~16:30) still fit.
   */
  scheduleStripStartHour: number
  scheduleStripEndHour: number
}

export const POMFRET_SITE: ObservatorySite = {
  id: 'pomfret',
  name: 'Pomfret School',
  timezone: 'America/New_York',
  elevationMeters: 150,
  weatherLat: 41.9159,
  weatherLon: -71.9626,
  observerLatDeg: 41 + 53 / 60 + 10 / 3600,
  observerLonDeg: -(71 + 57 / 60 + 54 / 3600),
  scheduleStripStartHour: 16,
  scheduleStripEndHour: 8,
}

/** Placeholder roof pin until Cygnus provides DMS; weather + observer share coords. */
export const CYGNUS_SITE: ObservatorySite = {
  id: 'cygnus',
  name: 'Cygnus Gymnasium',
  timezone: 'Europe/Amsterdam',
  elevationMeters: 20,
  weatherLat: 52.352,
  weatherLon: 4.912,
  observerLatDeg: 52.352,
  observerLonDeg: 4.912,
  // NL winter sunrise often ~08:45–09:00; winter sunset ~16:30 — widen vs Pomfret 16→08.
  scheduleStripStartHour: 15,
  scheduleStripEndHour: 10,
}

const SITES: Record<ObservatorySiteId, ObservatorySite> = {
  pomfret: POMFRET_SITE,
  cygnus: CYGNUS_SITE,
}

export const OBSERVATORY_SITES: ObservatorySite[] = [POMFRET_SITE, CYGNUS_SITE]

export const OBSERVATORY_SITE_COOKIE = 'pomfret_site'

export function isObservatorySiteId(value: string): value is ObservatorySiteId {
  return value === 'pomfret' || value === 'cygnus'
}

/** Missing or unknown `site` → Pomfret (existing URLs / agent polls unchanged). */
export function resolveObservatorySite(id?: string | null): ObservatorySite {
  if (id && isObservatorySiteId(id)) return SITES[id]
  return POMFRET_SITE
}

export function observatorySiteFromSearchParams(searchParams: URLSearchParams): ObservatorySite {
  return resolveObservatorySite(searchParams.get('site'))
}

/**
 * Resolve site from query, `X-Observatory-Site`, or `pomfret_site` cookie.
 * Agent URLs without `site` stay Pomfret.
 */
export function observatorySiteFromRequest(request: Request): ObservatorySite {
  const url = new URL(request.url)
  const fromQuery = url.searchParams.get('site')
  if (fromQuery) return resolveObservatorySite(fromQuery)
  const fromHeader = request.headers.get('x-observatory-site')
  if (fromHeader) return resolveObservatorySite(fromHeader)
  const cookie = request.headers.get('cookie')
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)pomfret_site=([^;]*)/)
    if (match?.[1]) {
      try {
        return resolveObservatorySite(decodeURIComponent(match[1].trim()))
      } catch {
        return resolveObservatorySite(match[1].trim())
      }
    }
  }
  return POMFRET_SITE
}

/** @deprecated Prefer `observatorySiteFromRequest` / explicit siteId. Defaults to Pomfret. */
export function liveImagingObservatorySite(id?: string | null): ObservatorySite {
  return resolveObservatorySite(id)
}

export function observatoryKvKey(siteId: string, key: string): string {
  if (!siteId || siteId === DEFAULT_OBSERVATORY_SITE_ID) return key
  return `site:${siteId}:${key}`
}

/** Append or replace `?site=` / `&site=` on a URL (NINA HttpUri, fetch helpers). */
export function withObservatorySiteQuery(url: string, siteId: ObservatorySiteId): string {
  const join = url.includes('?') ? '&' : '?'
  if (/[?&]site=/.test(url)) {
    return url.replace(/([?&])site=[^&]*/, `$1site=${encodeURIComponent(siteId)}`)
  }
  return `${url}${join}site=${encodeURIComponent(siteId)}`
}
