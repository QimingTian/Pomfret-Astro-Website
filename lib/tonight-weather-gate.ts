import { getAdminClosedWindowsInRange } from '@/lib/admin-closed-window-store'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import { currentObservatorySite } from '@/lib/observatory-site-scope'

const KMH_TO_MS = 1 / 3.6

/** Global hard gate: require this many consecutive fully weather-permitted night hours. */
export const MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS = 2
export const TONIGHT_WEATHER_MAX_CLOUD_PERCENT = 10
export const TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY = 10
export const TONIGHT_WEATHER_MAX_WIND_MS = 10

export type WeatherNotPermittedReason = 'cloud' | 'rain' | 'wind'

export type HourWeatherSample = {
  cloudCover: number
  precipProbability: number
  windSpeedMs: number
}

export type HourlyForecastSample = HourWeatherSample & {
  hourStartSec: number
}

export function weatherNotPermittedReasons(sample: HourWeatherSample): WeatherNotPermittedReason[] {
  const reasons: WeatherNotPermittedReason[] = []
  if (!Number.isFinite(sample.cloudCover) || sample.cloudCover >= TONIGHT_WEATHER_MAX_CLOUD_PERCENT) {
    reasons.push('cloud')
  }
  if (
    !Number.isFinite(sample.precipProbability) ||
    sample.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY
  ) {
    reasons.push('rain')
  }
  if (!Number.isFinite(sample.windSpeedMs) || sample.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS) {
    reasons.push('wind')
  }
  return reasons
}

export function isHourWeatherPermitted(sample: HourWeatherSample): boolean {
  return weatherNotPermittedReasons(sample).length === 0
}

/**
 * Remote header "Tonight's weather prediction: Permitted".
 * Only nautical dusk → nautical dawn hours count (not pre-dusk afternoon on the schedule strip).
 */
export function evaluateGlobalTonightWeatherPermitted(input: {
  hours: HourlyForecastSample[]
  gateStartSec: number
  gateEndSec: number
  nowSec: number
}): boolean {
  const { hours, gateStartSec, gateEndSec, nowSec } = input
  if (!Number.isFinite(gateStartSec) || !Number.isFinite(gateEndSec) || gateEndSec <= gateStartSec) {
    return false
  }
  const beforeGate = nowSec < gateStartSec
  const gateHours = hours.filter(
    (h) => h.hourStartSec >= gateStartSec && h.hourStartSec < gateEndSec
  )
  if (gateHours.length === 0) return false

  const countsToward = (hourStartSec: number): boolean => {
    const hourFullyEnded = hourStartSec + 3600 <= nowSec
    return beforeGate || !hourFullyEnded
  }

  let allPrecipUnder10 = true
  let windOver10HourCount = 0
  for (const h of gateHours) {
    if (!countsToward(h.hourStartSec)) continue
    if (!Number.isFinite(h.precipProbability) || h.precipProbability >= 10) {
      allPrecipUnder10 = false
    }
    if (!Number.isFinite(h.windSpeedMs) || h.windSpeedMs > 10) {
      windOver10HourCount += 1
    }
  }
  const windAllowedByHours = windOver10HourCount <= 3

  let consecutiveUnder10 = 0
  let hasMinConsecutiveUnder10 = false
  if (allPrecipUnder10 && windAllowedByHours) {
    for (const h of gateHours) {
      if (!countsToward(h.hourStartSec)) continue
      if (isHourWeatherPermitted(h)) {
        consecutiveUnder10 += 1
        if (consecutiveUnder10 >= MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS) {
          hasMinConsecutiveUnder10 = true
          break
        }
      } else {
        consecutiveUnder10 = 0
      }
    }
  }

  return allPrecipUnder10 && windAllowedByHours && hasMinConsecutiveUnder10
}

type OpenMeteoResponse = {
  hourly?: {
    time?: number[]
    cloud_cover?: number[]
    precipitation_probability?: number[]
    wind_speed_10m?: number[]
  }
  daily?: {
    sunrise?: number[]
    sunset?: number[]
  }
}

export type TonightWeatherGateResult = {
  status: 'permitted' | 'not_permitted' | 'unknown'
  reason: string
}

export type TimeInterval = { startMs: number; endMs: number }

export type TonightWeatherIntervalsResult = {
  status: 'ok' | 'unknown'
  permittedIntervals: TimeInterval[]
  nightStartMs?: number
  nightEndMs?: number
  globalHardBlocked?: boolean
  globalHardBlockReason?: string
  reason?: string
}

function localHourLabel(hourStartSec: number, timeZone: string): string {
  return new Date(hourStartSec * 1000).toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function globalWeatherBlockReason(
  checkedHours: HourlyForecastSample[],
  timeZone: string,
  evaluatedAtMs: number
): string {
  const failures = (hour: HourlyForecastSample) => {
    const parts: string[] = []
    if (!Number.isFinite(hour.cloudCover) || hour.cloudCover >= TONIGHT_WEATHER_MAX_CLOUD_PERCENT) {
      parts.push(`cloud ${Number.isFinite(hour.cloudCover) ? `${hour.cloudCover}%` : 'unavailable'} (limit <${TONIGHT_WEATHER_MAX_CLOUD_PERCENT}%)`)
    }
    if (!Number.isFinite(hour.precipProbability) || hour.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY) {
      parts.push(`precipitation ${Number.isFinite(hour.precipProbability) ? `${hour.precipProbability}%` : 'unavailable'} (limit <${TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY}%)`)
    }
    if (!Number.isFinite(hour.windSpeedMs) || hour.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS) {
      parts.push(`wind ${Number.isFinite(hour.windSpeedMs) ? `${hour.windSpeedMs.toFixed(1)} m/s` : 'unavailable'} (limit ≤${TONIGHT_WEATHER_MAX_WIND_MS} m/s)`)
    }
    return parts
  }
  const stamp = new Date(evaluatedAtMs).toLocaleString('en-US', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  const precipHits = checkedHours.filter((h) => !Number.isFinite(h.precipProbability) || h.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY)
  if (precipHits.length > 0) {
    return `Global weather trigger: precipitation ≥${TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY}% at ${precipHits.map((h) => `${localHourLabel(h.hourStartSec, timeZone)} (${Number.isFinite(h.precipProbability) ? `${h.precipProbability}%` : 'unavailable'})`).join(', ')}. Forecast checked ${stamp}.`
  }
  const highWind = checkedHours.filter((h) => !Number.isFinite(h.windSpeedMs) || h.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS)
  if (highWind.length > 3) {
    return `Global weather trigger: wind >${TONIGHT_WEATHER_MAX_WIND_MS} m/s in ${highWind.length} night hours (${highWind.map((h) => `${localHourLabel(h.hourStartSec, timeZone)}: ${Number.isFinite(h.windSpeedMs) ? `${h.windSpeedMs.toFixed(1)} m/s` : 'unavailable'}`).join(', ')}). Forecast checked ${stamp}.`
  }
  const sorted = [...checkedHours].sort((a, b) => a.hourStartSec - b.hourStartSec)
  let best: { start: HourlyForecastSample; failures: string[]; score: number } | null = null
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const first = sorted[i]!
    const second = sorted[i + 1]!
    if (second.hourStartSec - first.hourStartSec !== 3600) continue
    const failed = [
      ...failures(first).map((reason) => `${localHourLabel(first.hourStartSec, timeZone)}: ${reason}`),
      ...failures(second).map((reason) => `${localHourLabel(second.hourStartSec, timeZone)}: ${reason}`),
    ]
    if (failed.length > 0 && (!best || failed.length < best.score)) best = { start: first, failures: failed, score: failed.length }
  }
  if (!best) return `Global weather trigger: no consecutive forecast hours available to evaluate. Forecast checked ${stamp}.`
  const endLabel = localHourLabel(best.start.hourStartSec + 7200, timeZone)
  return `Global weather trigger: no ${MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS}-hour clear run. Closest window ${localHourLabel(best.start.hourStartSec, timeZone)}–${endLabel} failed: ${best.failures.join('; ')}. Forecast checked ${stamp}.`
}

/** Build the scheduler's weather decision from the exact forecast snapshot used by the schedule UI. */
export async function getTonightWeatherPermittedIntervalsFromSamples(
  samples: HourlyForecastSample[],
  sunsetSec: number,
  sunriseSec: number,
  timeZone: string,
  nowMs = Date.now()
): Promise<TonightWeatherIntervalsResult> {
  if (!Number.isFinite(sunsetSec) || !Number.isFinite(sunriseSec) || sunriseSec <= sunsetSec) {
    return { status: 'unknown', permittedIntervals: [], reason: 'Invalid forecast night bounds' }
  }
  const nightSamples = samples
    .filter((sample) => sample.hourStartSec >= sunsetSec && sample.hourStartSec < sunriseSec)
    .sort((a, b) => a.hourStartSec - b.hourStartSec)
  if (nightSamples.length === 0) {
    return { status: 'unknown', permittedIntervals: [], reason: 'No forecast samples for tonight window' }
  }
  const nightStartMs = sunsetSec * 1000
  const nightEndMs = sunriseSec * 1000
  const beforeNight = nowMs < nightStartMs
  const checkedHours = nightSamples.filter((h) => beforeNight || (h.hourStartSec + 3600) * 1000 > nowMs)
  const permittedIntervals = nightSamples
    .filter(isHourWeatherPermitted)
    .map((h) => ({
      startMs: Math.max(h.hourStartSec * 1000, nightStartMs),
      endMs: Math.min((h.hourStartSec + 3600) * 1000, nightEndMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
  const hasClearRun = checkedHours.some((first, index) => {
    const second = checkedHours[index + 1]
    return second != null && second.hourStartSec - first.hourStartSec === 3600 &&
      isHourWeatherPermitted(first) && isHourWeatherPermitted(second)
  })
  const hasPrecipHit = checkedHours.some((h) => !Number.isFinite(h.precipProbability) || h.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY)
  const highWindHours = checkedHours.filter((h) => !Number.isFinite(h.windSpeedMs) || h.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS).length
  const globalHardBlocked = hasPrecipHit || highWindHours > 3 || !hasClearRun

  let effectivePermittedIntervals = permittedIntervals
  try {
    for (const closed of await getAdminClosedWindowsInRange(nightStartMs, nightEndMs)) {
      effectivePermittedIntervals = subtractOccupiedFromFree(effectivePermittedIntervals, closed)
    }
  } catch {
    // Fall back to weather-only intervals if admin-window storage is unavailable.
  }
  return {
    status: 'ok',
    permittedIntervals: effectivePermittedIntervals,
    nightStartMs,
    nightEndMs,
    globalHardBlocked,
    globalHardBlockReason: globalHardBlocked ? globalWeatherBlockReason(checkedHours, timeZone, nowMs) : '',
  }
}

/**
 * Rule (Pomfret tonight, sunset -> next sunrise):
 * 1) some run of MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS consecutive hours passing hourly weather checks
 *    (cloud, precip, wind)
 * 2) every hour precipitation_probability < 10%
 * 3) hours with wind_speed_10m > 10 m/s must be <= 3
 *
 * Forward-looking global gate: before sunset, all forecast night hours count. After sunset (already
 * in night), hours that have fully ended (hour end <= now) do not count toward (1)-(3) — only
 * remaining night matters, so a bad hour in the past cannot veto the rest of the night.
 */
export async function evaluateTonightWeatherGate(): Promise<TonightWeatherGateResult> {
  const intervals = await getTonightWeatherPermittedIntervals()
  if (intervals.status !== 'ok' || !intervals.nightStartMs || !intervals.nightEndMs) {
    return { status: 'unknown', reason: intervals.reason ?? 'Weather forecast unavailable' }
  }
  const fullCoverage = weatherPermittedCoverageMs(intervals.permittedIntervals, intervals.nightStartMs, intervals.nightEndMs)
  const fullDuration = intervals.nightEndMs - intervals.nightStartMs
  const permitted = fullDuration > 0 && fullCoverage >= fullDuration * 0.8
  return {
    status: permitted ? 'permitted' : 'not_permitted',
    reason: permitted
      ? 'Tonight weather permits >=80% coverage of full-night window'
      : 'Tonight weather does not permit >=80% coverage of full-night window',
  }
}

export function weatherPermittedCoverageMs(
  permittedIntervals: TimeInterval[],
  startMs: number,
  endMs: number
): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  let covered = 0
  for (const interval of permittedIntervals) {
    const overlapStart = Math.max(startMs, interval.startMs)
    const overlapEnd = Math.min(endMs, interval.endMs)
    if (overlapEnd > overlapStart) covered += overlapEnd - overlapStart
  }
  return covered
}

export function weatherCoverageOk(
  permittedIntervals: TimeInterval[],
  startMs: number,
  endMs: number,
  requiredFraction = 0.8
): boolean {
  const duration = endMs - startMs
  if (!Number.isFinite(duration) || duration <= 0) return false
  const covered = weatherPermittedCoverageMs(permittedIntervals, startMs, endMs)
  return covered >= duration * requiredFraction
}

/**
 * Open-Meteo daily sunrise[i]/sunset[i] are civil events for local calendar day i.
 * The imaging night that begins on the evening of day i is sunset[i] → sunrise[i+1].
 *
 * After local midnight we are still in that night — do NOT use sunset[0]/sunrise[1] of
 * "today's" calendar row (that is tomorrow evening's night).
 */
export function pickOpenMeteoImagingNightBounds(
  sunsetsSec: number[],
  sunrisesSec: number[],
  nowMs = Date.now()
): { sunsetSec: number; sunriseSec: number } | null {
  const nowSec = nowMs / 1000
  let upcoming: { sunsetSec: number; sunriseSec: number } | null = null

  for (let i = 0; i < sunsetsSec.length; i++) {
    const sunsetSec = Number(sunsetsSec[i])
    const sunriseSec = Number(sunrisesSec[i + 1])
    if (!Number.isFinite(sunsetSec) || !Number.isFinite(sunriseSec) || sunriseSec <= sunsetSec) {
      continue
    }
    if (sunsetSec <= nowSec && nowSec < sunriseSec) {
      return { sunsetSec, sunriseSec }
    }
    if (sunsetSec > nowSec && upcoming == null) {
      upcoming = { sunsetSec, sunriseSec }
    }
  }

  return upcoming
}

export async function getTonightWeatherPermittedIntervals(): Promise<TonightWeatherIntervalsResult> {
  const site = currentObservatorySite()
  // past_days=1 keeps yesterday's sunset after local midnight so the current imaging night
  // (previous evening → this morning) is still present in daily[].
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${site.weatherLat}&longitude=${site.weatherLon}` +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m' +
    '&daily=sunrise,sunset' +
    `&past_days=1&forecast_days=2&timezone=${site.timezone}&timeformat=unixtime`

  try {
    const [res] = await Promise.all([
      fetch(url, { cache: 'no-store' }),
    ])
    if (!res.ok) {
      return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast unavailable' }
    }
    const data = (await res.json()) as OpenMeteoResponse
    const times = data.hourly?.time ?? []
    const clouds = data.hourly?.cloud_cover ?? []
    const precip = data.hourly?.precipitation_probability ?? []
    const wind = data.hourly?.wind_speed_10m ?? []
    const nightBounds = pickOpenMeteoImagingNightBounds(
      data.daily?.sunset ?? [],
      data.daily?.sunrise ?? []
    )
    if (
      !nightBounds ||
      times.length === 0 ||
      clouds.length !== times.length ||
      precip.length !== times.length ||
      wind.length !== times.length
    ) {
      return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast data incomplete' }
    }

    const samples: HourlyForecastSample[] = times.map((hourStartSec, i) => {
      const windKmh = Number(wind[i])
      return {
        hourStartSec,
        cloudCover: Number(clouds[i]),
        precipProbability: Number(precip[i]),
        windSpeedMs: Number.isFinite(windKmh) ? windKmh * KMH_TO_MS : Number.NaN,
      }
    })
    return getTonightWeatherPermittedIntervalsFromSamples(
      samples,
      nightBounds.sunsetSec,
      nightBounds.sunriseSec,
      site.timezone
    )
  } catch {
    return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast evaluation failed' }
  }
}

/** Every forecast hour overlapping [startMs, endMs) must have precipitation_probability < 10%. */
export async function sessionWindowHourlyPrecipOk(
  startMs: number,
  endMs: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, reason: 'Invalid session window.' }
  }
  const site = currentObservatorySite()
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${site.weatherLat}&longitude=${site.weatherLon}` +
    '&hourly=precipitation_probability' +
    `&forecast_days=2&timezone=${site.timezone}&timeformat=unixtime`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      return { ok: false, reason: 'Weather forecast unavailable.' }
    }
    const data = (await res.json()) as OpenMeteoResponse
    const times = data.hourly?.time ?? []
    const precip = data.hourly?.precipitation_probability ?? []
    if (times.length === 0 || precip.length !== times.length) {
      return { ok: false, reason: 'Weather forecast data incomplete.' }
    }
    for (let i = 0; i < times.length; i += 1) {
      const hourStartMs = times[i]! * 1000
      const hourEndMs = hourStartMs + 60 * 60 * 1000
      const overlapStart = Math.max(startMs, hourStartMs)
      const overlapEnd = Math.min(endMs, hourEndMs)
      if (overlapEnd <= overlapStart) continue
      const p = Number(precip[i])
      if (!Number.isFinite(p) || p >= 10) {
        return {
          ok: false,
          reason: 'At least one hour in the session window has precipitation probability >= 10%.',
        }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Weather forecast evaluation failed.' }
  }
}

/**
 * Admin force-run weather gate: only precipitation in the session window.
 * Cloud cover (and the night-wide global hard block that includes cloud runs) are ignored —
 * operators may force-run under cloudy skies when rain stays below 10% for every overlapping hour.
 */
export async function validateAdminRunWeatherWindow(
  startMs: number,
  endMs: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return sessionWindowHourlyPrecipOk(startMs, endMs)
}
