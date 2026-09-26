import type { ObservatorySite, ObservatoryStormAlertSource } from '@/lib/observatory-sites'

/**
 * Observed thunderstorm evidence near a site. Model forecasts (Open-Meteo WMO 95–99) miss
 * convection that the model did not resolve; station reports and official warnings do not.
 */

/** Airport stations within this radius count. METAR "LTG DSNT" already means 10–30 NM from the station. */
export const STORM_OBSERVATION_RADIUS_KM = 45
/** Ignore station reports older than this (hourly METAR + SPECI cadence). */
export const STORM_OBSERVATION_MAX_AGE_MS = 75 * 60 * 1000
const CACHE_MS = 2 * 60 * 1000
const USER_AGENT = 'pomfret-astro-weather-safety (https://www.pomfretastro.org)'
const EARTH_RADIUS_KM = 6371

export type MetarThunderSignal = {
  /** Present weather group contains TS (TS, +TSRA, VCTS, …). */
  thunder: boolean
  /** Remarks report lightning (LTG DSNT, OCNL LTGICCG, …). */
  lightning: boolean
}

export type StormObservation =
  | {
      source: 'metar'
      station: string
      distanceKm: number
      observedAt: string
      thunder: boolean
      lightning: boolean
      rawOb: string
    }
  | {
      source: 'nws' | 'meteoalarm'
      event: string
      headline: string | null
      expires: string | null
    }

export type StormObservationsResult = {
  observations: StormObservation[]
  /** At least one upstream (METAR or alerts) answered. */
  available: boolean
}

const PRESENT_WEATHER_TS = /^(?:[+-]|VC)?(?:[A-Z]{2})*TS(?:[A-Z]{2})*$/
const OBS_TIME_GROUP = /^\d{6}Z$/

/** Parse a raw METAR/SPECI for thunder in present weather or lightning in remarks. */
export function parseMetarThunder(rawOb: string): MetarThunderSignal {
  const text = rawOb.trim().toUpperCase()
  const rmkAt = text.search(/\sRMK(\s|$)/)
  const body = rmkAt >= 0 ? text.slice(0, rmkAt) : text
  const remarks = rmkAt >= 0 ? text.slice(rmkAt) : ''
  const tokens = body.split(/\s+/)
  const timeIdx = tokens.findIndex((t) => OBS_TIME_GROUP.test(t))
  const weatherTokens = timeIdx >= 0 ? tokens.slice(timeIdx + 1) : tokens.slice(2)
  const thunder = weatherTokens.some((t) => PRESENT_WEATHER_TS.test(t))
  const lightning = /\bLTG/.test(remarks)
  return { thunder, lightning }
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

type MetarJson = {
  icaoId?: string
  obsTime?: number
  rawOb?: string
  lat?: number
  lon?: number
}

/** Latest report per station within radius; keep only thunder/lightning ones. */
export function metarThunderObservations(
  reports: MetarJson[],
  site: { lat: number; lon: number },
  nowMs: number,
  radiusKm = STORM_OBSERVATION_RADIUS_KM
): StormObservation[] {
  const latest = new Map<string, MetarJson>()
  for (const r of reports) {
    if (!r.icaoId || typeof r.rawOb !== 'string' || typeof r.obsTime !== 'number') continue
    const prev = latest.get(r.icaoId)
    if (!prev || (prev.obsTime ?? 0) < r.obsTime) latest.set(r.icaoId, r)
  }
  const out: Array<Extract<StormObservation, { source: 'metar' }>> = []
  for (const r of Array.from(latest.values())) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue
    const obsMs = r.obsTime! * 1000
    if (nowMs - obsMs > STORM_OBSERVATION_MAX_AGE_MS) continue
    const distanceKm = haversineKm(site.lat, site.lon, r.lat, r.lon)
    if (distanceKm > radiusKm) continue
    const signal = parseMetarThunder(r.rawOb!)
    if (!signal.thunder && !signal.lightning) continue
    out.push({
      source: 'metar',
      station: r.icaoId!,
      distanceKm,
      observedAt: new Date(obsMs).toISOString(),
      thunder: signal.thunder,
      lightning: signal.lightning,
      rawOb: r.rawOb!,
    })
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm)
}

const NWS_THUNDER_EVENTS = /Severe Thunderstorm Warning|Tornado Warning/i

type NwsAlertsJson = {
  features?: Array<{ properties?: { event?: string; headline?: string; expires?: string } }>
}

export function nwsThunderObservations(data: NwsAlertsJson): StormObservation[] {
  const out: StormObservation[] = []
  for (const f of data.features ?? []) {
    const event = f.properties?.event ?? ''
    if (!NWS_THUNDER_EVENTS.test(event)) continue
    out.push({
      source: 'nws',
      event,
      headline: f.properties?.headline ?? null,
      expires: f.properties?.expires ?? null,
    })
  }
  return out
}

type MeteoAlarmJson = {
  warnings?: Array<{
    alert?: {
      info?: Array<{
        event?: string
        headline?: string
        onset?: string
        effective?: string
        expires?: string
        language?: string
        area?: Array<{ geocode?: Array<{ value?: string }> }>
        parameter?: Array<{ valueName?: string; value?: string }>
      }>
    }
  }>
}

/** Active (onset ≤ now < expires) yellow-or-worse thunderstorm warnings for the given EMMA area codes. */
export function meteoAlarmThunderObservations(
  data: MeteoAlarmJson,
  areaCodes: string[],
  nowMs: number
): StormObservation[] {
  const wanted = new Set(areaCodes)
  const out: StormObservation[] = []
  const seen = new Set<string>()
  for (const w of data.warnings ?? []) {
    const infos = w.alert?.info ?? []
    const english = infos.filter((i) => i.language && /^en/i.test(i.language))
    for (const info of english.length > 0 ? english : infos) {
      const params = info.parameter ?? []
      const type = params.find((p) => p.valueName === 'awareness_type')?.value ?? ''
      const level = params.find((p) => p.valueName === 'awareness_level')?.value ?? ''
      if (!/^3;/.test(type.trim())) continue
      const levelNum = Number.parseInt(level, 10)
      if (!Number.isFinite(levelNum) || levelNum < 2) continue
      const inArea = (info.area ?? []).some((a) => (a.geocode ?? []).some((g) => g.value && wanted.has(g.value)))
      if (!inArea) continue
      const startMs = Date.parse(info.onset ?? info.effective ?? '')
      const endMs = Date.parse(info.expires ?? '')
      if (Number.isFinite(startMs) && nowMs < startMs) continue
      if (Number.isFinite(endMs) && nowMs >= endMs) continue
      const key = `${info.event}|${info.onset}|${info.expires}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        source: 'meteoalarm',
        event: info.event ?? 'Thunderstorm warning',
        headline: info.headline ?? null,
        expires: info.expires ?? null,
      })
    }
  }
  return out
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/geo+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function metarBbox(lat: number, lon: number, radiusKm: number): string {
  const dLat = radiusKm / 111
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(3)).join(',')
}

async function fetchAlertObservations(
  source: ObservatoryStormAlertSource,
  lat: number,
  lon: number,
  nowMs: number
): Promise<StormObservation[] | null> {
  if (source.provider === 'nws') {
    const data = await fetchJson<NwsAlertsJson>(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`
    )
    return data ? nwsThunderObservations(data) : null
  }
  const data = await fetchJson<MeteoAlarmJson>(
    `https://feeds.meteoalarm.org/api/v1/warnings/${encodeURIComponent(source.feed)}`
  )
  return data ? meteoAlarmThunderObservations(data, source.areaCodes, nowMs) : null
}

type CacheEntry = { atMs: number; result: StormObservationsResult }
type GlobalWithStormObs = typeof globalThis & {
  __pomfret_storm_observations_cache__?: Record<string, CacheEntry>
}

function cache(): Record<string, CacheEntry> {
  const g = globalThis as GlobalWithStormObs
  if (!g.__pomfret_storm_observations_cache__) g.__pomfret_storm_observations_cache__ = {}
  return g.__pomfret_storm_observations_cache__
}

/** METAR thunder/lightning within {@link STORM_OBSERVATION_RADIUS_KM} + official regional warnings. */
export async function fetchStormObservations(
  site: ObservatorySite,
  nowMs = Date.now()
): Promise<StormObservationsResult> {
  const hit = cache()[site.id]
  if (hit && nowMs - hit.atMs < CACHE_MS) return hit.result

  const lat = site.observerLatDeg
  const lon = site.observerLonDeg
  const [metars, alerts] = await Promise.all([
    fetchJson<MetarJson[]>(
      `https://aviationweather.gov/api/data/metar?bbox=${metarBbox(lat, lon, STORM_OBSERVATION_RADIUS_KM)}&hours=2&format=json`
    ),
    fetchAlertObservations(site.stormAlerts, lat, lon, nowMs),
  ])
  const observations: StormObservation[] = [
    ...(Array.isArray(metars) ? metarThunderObservations(metars, { lat, lon }, nowMs) : []),
    ...(alerts ?? []),
  ]
  const result: StormObservationsResult = {
    observations,
    available: Array.isArray(metars) || alerts != null,
  }
  cache()[site.id] = { atMs: nowMs, result }
  return result
}

export function describeStormObservation(obs: StormObservation): string {
  if (obs.source === 'metar') {
    const what = obs.thunder ? 'thunderstorm' : 'lightning'
    return `${obs.station} (~${obs.distanceKm.toFixed(0)} km) reports ${what}`
  }
  const who = obs.source === 'nws' ? 'NWS' : 'MeteoAlarm'
  return `${who}: ${obs.event}`
}
