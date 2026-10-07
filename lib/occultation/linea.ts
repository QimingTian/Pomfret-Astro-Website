import { altitudeSessionCoverageOk } from '@/lib/target-altitude'
import { targetMoonSeparationDeg } from '@/lib/moon-avoidance'
import type { ObservatorySite } from '@/lib/observatory-sites'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

import {
  OCCULTATION_FEED_CACHE_MS,
  OCCULTATION_LOCATION_RADIUS_KM,
  OCCULTATION_MAG_MAX,
  occultationExposurePlan,
  occultationSubExposureSeconds,
} from './plan'
import type { OccultationEvent } from './types'

const LINEA_OCCULTATIONS_URL = 'https://solarsystem.linea.org.br/api/occultations/'
const MAX_PAGES = 4

type CacheEntry = { at: number; events: OccultationEvent[] }

const cache = new Map<string, CacheEntry>()

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function asteroidLabel(raw: Record<string, unknown>): string {
  const number = finiteNumber(raw.number)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
  const designation =
    typeof raw.principal_designation === 'string' && raw.principal_designation.trim()
      ? raw.principal_designation.trim()
      : ''
  const body = name || designation || 'Asteroid'
  if (number != null && number > 0 && !body.startsWith('(')) return `(${Math.round(number)}) ${body}`
  return body
}

function starLabel(raw: Record<string, unknown>): string {
  const gaia = raw.gaia_source_id
  if (typeof gaia === 'string' && gaia.trim()) return `Gaia DR3 ${gaia.trim()}`
  if (typeof gaia === 'number' && Number.isFinite(gaia)) return `Gaia DR3 ${Math.round(gaia)}`
  return 'Star'
}

export function occultationEventFromLinea(raw: Record<string, unknown>): OccultationEvent | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const eventIsoRaw = typeof raw.date_time === 'string' ? raw.date_time.trim() : ''
  const eventMs = Date.parse(eventIsoRaw)
  const raDeg = finiteNumber(raw.ra_star_deg)
  const decDeg = finiteNumber(raw.dec_star_deg)
  if (!id || !Number.isFinite(eventMs) || raDeg == null || decDeg == null) return null
  const raHours = raDeg / 15
  if (raHours < 0 || raHours >= 24 || decDeg < -90 || decDeg > 90) return null

  const magnitude = finiteNumber(raw.g_star)
  if (magnitude != null && magnitude > OCCULTATION_MAG_MAX) return null

  const durationSeconds = finiteNumber(raw.event_duration)
  const exposureSeconds = occultationSubExposureSeconds(magnitude)
  const plan = occultationExposurePlan(eventMs, durationSeconds, exposureSeconds)
  const moonFromFeed = finiteNumber(raw.moon_separation)
  return {
    id,
    asteroid: asteroidLabel(raw),
    star: starLabel(raw),
    eventIso: new Date(eventMs).toISOString(),
    durationSeconds: durationSeconds != null && durationSeconds > 0 ? durationSeconds : null,
    magnitude,
    magnitudeDrop: finiteNumber(raw.magnitude_drop),
    moonSeparationDeg: moonFromFeed ?? targetMoonSeparationDeg(raHours, decDeg, new Date(eventMs)),
    raHours,
    decDeg,
    plannedStartIso: new Date(plan.plannedStartMs).toISOString(),
    eventFinishIso: new Date(plan.eventFinishMs).toISOString(),
    exposureSeconds: plan.exposureSeconds,
    exposureCount: plan.exposureCount,
    estimatedDurationSeconds: plan.estimatedDurationSeconds,
    altitudeOk: altitudeSessionCoverageOk(raHours, decDeg, plan.plannedStartMs, plan.eventFinishMs),
  }
}

function cacheKey(site: ObservatorySite, duskMs: number, dawnMs: number): string {
  return `${site.id}:${duskMs}:${dawnMs}:${OCCULTATION_LOCATION_RADIUS_KM}`
}

async function fetchLineaPage(url: string): Promise<{ results: unknown[]; next: string | null }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PomfretAstro/occultation' },
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`LIneA occultation feed HTTP ${res.status}`)
  const body = (await res.json()) as { results?: unknown; next?: unknown }
  const results = Array.isArray(body.results) ? body.results : []
  const next = typeof body.next === 'string' && body.next.trim() ? body.next.trim() : null
  return { results, next }
}

export async function loadOccultationEvents(site: ObservatorySite, now = new Date()): Promise<OccultationEvent[]> {
  const window = getTonightSchedulingWindow(now, site)
  const duskMs = window.nauticalDuskUtc.getTime()
  const dawnMs = window.nauticalDawnUtc.getTime()
  const key = cacheKey(site, duskMs, dawnMs)
  const hit = cache.get(key)
  if (hit && now.getTime() - hit.at < OCCULTATION_FEED_CACHE_MS) return hit.events

  const params = new URLSearchParams({
    date_time_after: window.nauticalDuskUtc.toISOString(),
    date_time_before: window.nauticalDawnUtc.toISOString(),
    nightside: 'true',
    magnitude_max: String(OCCULTATION_MAG_MAX),
    latitude: String(site.observerLatDeg),
    longitude: String(site.observerLonDeg),
    location_radius: String(OCCULTATION_LOCATION_RADIUS_KM),
  })
  let url: string | null = `${LINEA_OCCULTATIONS_URL}?${params.toString()}`
  const events: OccultationEvent[] = []
  const seen = new Set<string>()
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const payload = await fetchLineaPage(url)
    for (const item of payload.results) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const event = occultationEventFromLinea(item as Record<string, unknown>)
      if (!event || seen.has(event.id) || !event.altitudeOk) continue
      const eventMs = Date.parse(event.eventIso)
      const finishMs = Date.parse(event.eventFinishIso)
      if (eventMs < duskMs || eventMs > dawnMs || finishMs <= now.getTime()) continue
      seen.add(event.id)
      events.push(event)
    }
    url = payload.next
  }
  events.sort((a, b) => a.eventIso.localeCompare(b.eventIso))
  cache.set(key, { at: now.getTime(), events })
  return events
}
