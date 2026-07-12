import { appendAuditLog } from '@/lib/imaging-audit-log'
import { fetchAscCloud } from '@/lib/asc-cloud'
import {
  armEmergencyStop,
  emergencyStopAuditDetail,
  emergencyStopTriggeredBySuffix,
  isEmergencyStopBlocking,
  updateEmergencyStopHeldSessionIds,
} from '@/lib/imaging-emergency-stop'
import { applyEmergencyStopHolds } from '@/lib/imaging-emergency-stop-holds'
import {
  clearNinaStoppedPendingFail,
  failInProgressBoardSessions,
  failInProgressProjectSubSessions,
} from '@/lib/imaging-session-failure'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { isObservatoryNight } from '@/lib/observatory-poll-schedule'
import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

/** Lead-time ring for thunderstorm approach (≈30–60 min at typical summer storm speeds). */
export const STORM_APPROACH_RADIUS_KM = 20
/** Open-Meteo site current-hour precip probability must be strictly above this (%) to ESTOP. */
export const PRECIP_ESTOP_THRESHOLD = 20
/** ASC rain confidence (0–1) threshold; ESTOP only when detected=true AND confidence >= this. */
export const ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD = 0.99
export const WEATHER_SAFETY_DEBOUNCE_MS = 45_000

const DEBOUNCE_KV_KEY = 'imaging-weather-safety-estop-last-arm'
const EARTH_RADIUS_KM = 6371
const THUNDERSTORM_CODES = new Set([95, 96, 99])

export type WeatherSafetyThreatKind = 'storm_approach' | 'site_precip' | 'asc_rain'

export type WeatherSafetyThreat = {
  kind: WeatherSafetyThreatKind
  reason: string
  detail: Record<string, unknown>
}

export type WeatherSafetyArmResult = {
  armed: boolean
  skipped?: 'no_threat' | 'daytime' | 'already_blocking' | 'debounced' | 'error'
  threat?: WeatherSafetyThreat
  queueId?: string
}

type GlobalWithWeatherSafety = typeof globalThis & {
  __pomfret_weather_safety_last_arm_ms__?: number
  __pomfret_weather_safety_arm_inflight__?: Promise<WeatherSafetyArmResult> | null
}

type ForecastHourSample = {
  timeSec: number
  precipProbability: number
  weatherCode: number
}

type LocationForecast = {
  lat: number
  lon: number
  distanceKm: number
  hours: ForecastHourSample[]
}

export function isThunderstormWeatherCode(code: number): boolean {
  return Number.isFinite(code) && THUNDERSTORM_CODES.has(Math.round(code))
}

/** True when precip probability is strictly greater than the ESTOP threshold (default 20%). */
export function precipThreatAbove(
  precipProbability: number,
  threshold = PRECIP_ESTOP_THRESHOLD
): boolean {
  return Number.isFinite(precipProbability) && precipProbability > threshold
}

/** ASC rain ESTOP only when detected=true AND confidence >= threshold (ignore high confidence with detected=false). */
export function ascRainThreat(
  rain: { detected?: boolean; confidence?: number | null } | null | undefined,
  threshold = ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD
): boolean {
  if (rain?.detected !== true) return false
  const confidence = rain.confidence
  return typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= threshold
}

/** Bearing 0° = north; returns points on a circle plus the center. */
export function ringSampleCoordinates(
  latDeg: number,
  lonDeg: number,
  radiusKm: number,
  count = 8
): Array<{ lat: number; lon: number; bearingDeg: number; distanceKm: number }> {
  const out: Array<{ lat: number; lon: number; bearingDeg: number; distanceKm: number }> = [
    { lat: latDeg, lon: lonDeg, bearingDeg: 0, distanceKm: 0 },
  ]
  const latRad = (latDeg * Math.PI) / 180
  const angular = radiusKm / EARTH_RADIUS_KM
  for (let i = 0; i < count; i++) {
    const bearingDeg = (i * 360) / count
    const bearing = (bearingDeg * Math.PI) / 180
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing)
    )
    const lon2 =
      ((lonDeg * Math.PI) / 180) +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
        Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2)
      )
    out.push({
      lat: (lat2 * 180) / Math.PI,
      lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
      bearingDeg,
      distanceKm: radiusKm,
    })
  }
  return out
}

function currentAndNextHourSamples(
  hours: ForecastHourSample[],
  nowSec: number
): { current: ForecastHourSample | null; next: ForecastHourSample | null } {
  if (hours.length === 0) return { current: null, next: null }
  const sorted = [...hours].sort((a, b) => a.timeSec - b.timeSec)
  let current: ForecastHourSample | null = null
  let next: ForecastHourSample | null = null
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i]!
    const end = h.timeSec + 3600
    if (h.timeSec <= nowSec && nowSec < end) {
      current = h
      next = sorted[i + 1] ?? null
      break
    }
    if (h.timeSec > nowSec) {
      current = null
      next = h
      break
    }
  }
  if (!current && !next && sorted.length > 0) {
    const last = sorted[sorted.length - 1]!
    if (nowSec < last.timeSec + 3600) current = last
  }
  return { current, next }
}

/**
 * Night auto-ESTOP threats (any one fires):
 * 1) 20 km thunderstorm approach (Unsafe)
 * 2) Open-Meteo site current-hour precip probability > 20%
 * 3) ASC rain detected=true AND confidence >= 99%
 */
export function pickWeatherSafetyThreat(input: {
  ascRainDetected?: boolean
  ascRainConfidence?: number | null
  ringLocations: LocationForecast[]
  nowSec?: number
}): WeatherSafetyThreat | null {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000)

  const storm = pickStormApproachThreat({
    ringLocations: input.ringLocations,
    nowSec,
  })
  if (storm) return storm

  const precip = pickSitePrecipThreat({
    ringLocations: input.ringLocations,
    nowSec,
  })
  if (precip) return precip

  if (
    ascRainThreat({
      detected: input.ascRainDetected,
      confidence: input.ascRainConfidence,
    })
  ) {
    return {
      kind: 'asc_rain',
      reason: `ASC AI detected rain with confidence ${(input.ascRainConfidence! * 100).toFixed(1)}% >= ${ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD * 100}% during nautical night (dusk→dawn).`,
      detail: {
        ascRainDetected: true,
        ascRainConfidence: input.ascRainConfidence,
        threshold: ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD,
      },
    }
  }

  return null
}

/** Site (observatory) current-hour Open-Meteo precip probability > {@link PRECIP_ESTOP_THRESHOLD}. */
export function pickSitePrecipThreat(input: {
  ringLocations: LocationForecast[]
  nowSec?: number
}): WeatherSafetyThreat | null {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000)
  const site = input.ringLocations.find((loc) => loc.distanceKm <= 0)
  if (!site) return null
  const { current } = currentAndNextHourSamples(site.hours, nowSec)
  if (!current || !precipThreatAbove(current.precipProbability)) return null
  return {
    kind: 'site_precip',
    reason: `Open-Meteo site precip probability ${current.precipProbability}% > ${PRECIP_ESTOP_THRESHOLD}% for the current hour during nautical night.`,
    detail: {
      precipProbability: current.precipProbability,
      threshold: PRECIP_ESTOP_THRESHOLD,
      hourStartSec: current.timeSec,
      weatherCode: current.weatherCode,
      lat: site.lat,
      lon: site.lon,
    },
  }
}

/** Same 20 km Open-Meteo ring + WMO thunder codes used by weather-safety ESTOP. */
export function pickStormApproachThreat(input: {
  ringLocations: LocationForecast[]
  nowSec?: number
}): WeatherSafetyThreat | null {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000)
  for (const loc of input.ringLocations) {
    if (loc.distanceKm <= 0) continue
    const { current, next } = currentAndNextHourSamples(loc.hours, nowSec)
    for (const label of ['current', 'next'] as const) {
      const hour = label === 'current' ? current : next
      if (!hour) continue
      if (!isThunderstormWeatherCode(hour.weatherCode)) continue
      return {
        kind: 'storm_approach',
        reason: `Thunderstorm weather code ${hour.weatherCode} within ${STORM_APPROACH_RADIUS_KM} km during nautical night (${label} hour, ~${loc.distanceKm.toFixed(0)} km away).`,
        detail: {
          hour: label,
          weatherCode: hour.weatherCode,
          precipProbability: hour.precipProbability,
          lat: loc.lat,
          lon: loc.lon,
          distanceKm: loc.distanceKm,
          hourStartSec: hour.timeSec,
          radiusKm: STORM_APPROACH_RADIUS_KM,
        },
      }
    }
  }
  return null
}

function parseOpenMeteoMulti(
  data: unknown,
  points: Array<{ lat: number; lon: number; distanceKm: number }>
): LocationForecast[] {
  const asArray = Array.isArray(data) ? data : data != null ? [data] : []
  const out: LocationForecast[] = []
  for (let i = 0; i < points.length; i++) {
    const block = asArray[i] as
      | {
          latitude?: number
          longitude?: number
          hourly?: {
            time?: number[]
            precipitation_probability?: number[]
            weather_code?: number[]
          }
        }
      | undefined
    const point = points[i]!
    const times = block?.hourly?.time ?? []
    const precip = block?.hourly?.precipitation_probability ?? []
    const codes = block?.hourly?.weather_code ?? []
    const hours: ForecastHourSample[] = []
    for (let j = 0; j < times.length; j++) {
      const timeSec = Number(times[j])
      if (!Number.isFinite(timeSec)) continue
      hours.push({
        timeSec,
        precipProbability: Number(precip[j]),
        weatherCode: Number(codes[j]),
      })
    }
    out.push({
      lat: typeof block?.latitude === 'number' ? block.latitude : point.lat,
      lon: typeof block?.longitude === 'number' ? block.longitude : point.lon,
      distanceKm: point.distanceKm,
      hours,
    })
  }
  return out
}

async function fetchRingForecasts(): Promise<LocationForecast[] | null> {
  const points = ringSampleCoordinates(OBS_LAT_DEG, OBS_LON_DEG, STORM_APPROACH_RADIUS_KM, 8)
  const lats = points.map((p) => p.lat.toFixed(4)).join(',')
  const lons = points.map((p) => p.lon.toFixed(4)).join(',')
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lats}&longitude=${lons}` +
    '&hourly=precipitation_probability,weather_code' +
    '&forecast_days=1&timezone=America/New_York&timeformat=unixtime'

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return parseOpenMeteoMulti(
      data,
      points.map((p) => ({ lat: p.lat, lon: p.lon, distanceKm: p.distanceKm }))
    )
  } catch {
    return null
  }
}

export async function evaluateWeatherSafetyThreat(): Promise<WeatherSafetyThreat | null> {
  const [ascCloud, ringLocations] = await Promise.all([fetchAscCloud(), fetchRingForecasts()])
  const ascRainDetected = ascCloud?.rain?.detected === true
  const ascRainConfidence = ascCloud?.rain?.confidence
  if (!ringLocations) {
    if (ascRainThreat({ detected: ascRainDetected, confidence: ascRainConfidence })) {
      return {
        kind: 'asc_rain',
        reason: `ASC AI detected rain with confidence ${(ascRainConfidence! * 100).toFixed(1)}% >= ${ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD * 100}% during nautical night (dusk→dawn).`,
        detail: {
          ascRainDetected: true,
          ascRainConfidence,
          threshold: ASC_RAIN_CONFIDENCE_ESTOP_THRESHOLD,
          forecastUnavailable: true,
        },
      }
    }
    return null
  }
  return pickWeatherSafetyThreat({
    ascRainDetected,
    ascRainConfidence,
    ringLocations,
  })
}

export type StormApproachStatus = {
  /** false when a thunderstorm code is on the approach ring (current/next hour). */
  safe: boolean
  radiusKm: number
  threat: WeatherSafetyThreat | null
}

/** UI + ESTOP share this: Open-Meteo ring at {@link STORM_APPROACH_RADIUS_KM}. */
export async function evaluateStormApproachStatus(): Promise<StormApproachStatus | null> {
  const ringLocations = await fetchRingForecasts()
  if (!ringLocations) return null
  const threat = pickStormApproachThreat({ ringLocations })
  return {
    safe: threat == null,
    radiusKm: STORM_APPROACH_RADIUS_KM,
    threat,
  }
}

async function readDebounceMs(): Promise<number> {
  const mem = (globalThis as GlobalWithWeatherSafety).__pomfret_weather_safety_last_arm_ms__
  if (typeof mem === 'number' && Number.isFinite(mem)) return mem
  if (kvEnabled()) {
    const remote = await kvGetJson<{ atMs?: number }>(DEBOUNCE_KV_KEY)
    if (typeof remote?.atMs === 'number' && Number.isFinite(remote.atMs)) {
      ;(globalThis as GlobalWithWeatherSafety).__pomfret_weather_safety_last_arm_ms__ = remote.atMs
      return remote.atMs
    }
  }
  return 0
}

async function writeDebounceMs(atMs: number): Promise<void> {
  ;(globalThis as GlobalWithWeatherSafety).__pomfret_weather_safety_last_arm_ms__ = atMs
  if (kvEnabled()) {
    await kvSetJson(DEBOUNCE_KV_KEY, { atMs })
  }
}

const WEATHER_SAFETY_ACTOR = {
  displayName: 'Weather Safety (auto)',
  userId: 'weather-safety-auto',
  username: 'weather-safety-auto',
  email: '',
}

async function armWeatherSafetyEmergencyStop(
  threat: WeatherSafetyThreat
): Promise<WeatherSafetyArmResult> {
  const heldSessionIds = await applyEmergencyStopHolds()
  const state = await armEmergencyStop(WEATHER_SAFETY_ACTOR, heldSessionIds)
  if (heldSessionIds.length !== state.heldSessionIds.length) {
    await updateEmergencyStopHeldSessionIds(heldSessionIds)
  }

  const failedSubs = await failInProgressProjectSubSessions('emergency_stop')
  const failedBoard = await failInProgressBoardSessions(undefined, 'emergency_stop')
  await clearNinaStoppedPendingFail()
  await writeDebounceMs(Date.now())

  await appendAuditLog({
    kind: 'emergency_stop',
    message: `Emergency STOP armed (${state.queueId})${emergencyStopTriggeredBySuffix(state)} by weather safety: ${threat.reason} ${heldSessionIds.length} session(s) on hold; failed ${failedSubs.length + failedBoard.length} in-progress.`,
    detail: emergencyStopAuditDetail({
      queueId: state.queueId,
      requestedAt: state.requestedAt,
      requestedBy: state.requestedBy,
      requestedByUserId: state.requestedByUserId,
      requestedByUsername: state.requestedByUsername,
      requestedByEmail: state.requestedByEmail,
      event: 'armed',
      source: 'weather_safety_auto',
      threatKind: threat.kind,
      threatReason: threat.reason,
      threatDetail: threat.detail,
      heldSessionIds,
      failedProjectSubSessions: failedSubs,
      failedBoardSessions: failedBoard,
      gate: 'nautical_night',
    }),
  })

  return { armed: true, threat, queueId: state.queueId }
}

/**
 * During nautical night (dusk→dawn), arm ESTOP on thunderstorm Unsafe, site precip >20%,
 * or ASC rain detected with confidence >=99%. Daytime is a no-op. Ignores session in-progress.
 */
export async function maybeArmWeatherSafetyEmergencyStop(): Promise<WeatherSafetyArmResult> {
  const g = globalThis as GlobalWithWeatherSafety
  if (g.__pomfret_weather_safety_arm_inflight__) {
    return g.__pomfret_weather_safety_arm_inflight__
  }

  const run = (async (): Promise<WeatherSafetyArmResult> => {
    try {
      if (!isObservatoryNight()) {
        return { armed: false, skipped: 'daytime' }
      }
      if (await isEmergencyStopBlocking()) {
        return { armed: false, skipped: 'already_blocking' }
      }
      const lastArm = await readDebounceMs()
      if (Date.now() - lastArm < WEATHER_SAFETY_DEBOUNCE_MS) {
        return { armed: false, skipped: 'debounced' }
      }
      const threat = await evaluateWeatherSafetyThreat()
      if (!threat) {
        return { armed: false, skipped: 'no_threat' }
      }
      if (await isEmergencyStopBlocking()) {
        return { armed: false, skipped: 'already_blocking', threat }
      }
      return await armWeatherSafetyEmergencyStop(threat)
    } catch {
      return { armed: false, skipped: 'error' }
    }
  })()

  g.__pomfret_weather_safety_arm_inflight__ = run
  try {
    return await run
  } finally {
    if (g.__pomfret_weather_safety_arm_inflight__ === run) {
      g.__pomfret_weather_safety_arm_inflight__ = null
    }
  }
}

/** Fire-and-forget wrapper for status/pulse hooks. */
export function triggerWeatherSafetyEmergencyStopCheck(): void {
  void maybeArmWeatherSafetyEmergencyStop()
}
