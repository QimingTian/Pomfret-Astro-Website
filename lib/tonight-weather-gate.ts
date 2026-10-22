import { currentObservatorySite } from '@/lib/observatory-site-scope'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'

const KMH_TO_MS = 1 / 3.6

/** Global hard gate: require this many consecutive fully weather-permitted night hours. */
export const MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS = 2
export const TONIGHT_WEATHER_MAX_CLOUD_PERCENT = 10
export const TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY = 10
export const NIGHTWIDE_PRECIPITATION_BLOCK_PROBABILITY = 80
export const TONIGHT_WEATHER_MAX_WIND_MS = 10
export const FORECAST_PRECIPITATION_FINISH_BUFFER_MS = 2 * 60 * 60 * 1000

export type WeatherNotPermittedReason = 'cloud' | 'rain' | 'wind'

export type HourWeatherSample = {
  cloudCover: number
  precipProbability: number
  windSpeedMs: number
}

export type HourlyForecastSample = HourWeatherSample & {
  hourStartSec: number
}

export type PrecipitationForecastHour = Pick<HourlyForecastSample, 'hourStartSec' | 'precipProbability'>

/** A severe forecast anywhere in the civil sunset-to-sunrise night vetoes the entire night. */
export function findNightwideSeverePrecipitationHour<T extends PrecipitationForecastHour>(
  samples: T[],
  sunsetSec: number,
  sunriseSec: number
): T | undefined {
  if (!Number.isFinite(sunsetSec) || !Number.isFinite(sunriseSec) || sunriseSec <= sunsetSec) return undefined
  return [...samples]
    .filter((h) => h.hourStartSec < sunriseSec && h.hourStartSec + 3600 > sunsetSec)
    .sort((a, b) => a.hourStartSec - b.hourStartSec)
    .find((h) => Number.isFinite(h.precipProbability) && h.precipProbability >= NIGHTWIDE_PRECIPITATION_BLOCK_PROBABILITY)
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
    (h) => h.hourStartSec < gateEndSec && h.hourStartSec + 3600 > gateStartSec
  ).sort((a, b) => a.hourStartSec - b.hourStartSec)
  if (gateHours.length === 0) return false

  const countsToward = (hourStartSec: number): boolean => {
    const hourFullyEnded = hourStartSec + 3600 <= nowSec
    return beforeGate || !hourFullyEnded
  }

  const firstPrecip = gateHours.find((h) =>
    countsToward(h.hourStartSec) &&
    (!Number.isFinite(h.precipProbability) || h.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY)
  )
  const cutoffSec = Math.min(
    gateEndSec,
    firstPrecip == null ? gateEndSec : firstPrecip.hourStartSec - FORECAST_PRECIPITATION_FINISH_BUFFER_MS / 1000
  )
  const windOver10HourCount = gateHours.filter((h) =>
    countsToward(h.hourStartSec) && h.hourStartSec < cutoffSec &&
    (!Number.isFinite(h.windSpeedMs) || h.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS)
  ).length
  if (windOver10HourCount > 3) return false
  let runStart: number | null = null
  let runEnd = 0
  for (const h of gateHours) {
    if (!countsToward(h.hourStartSec) || !isHourWeatherPermitted(h)) continue
    const start = Math.max(h.hourStartSec, gateStartSec, nowSec)
    const end = Math.min(h.hourStartSec + 3600, cutoffSec)
    if (end <= start) continue
    if (runStart == null || start > runEnd) runStart = start
    runEnd = end
    if (runEnd - runStart >= MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS * 3600) return true
  }
  return false
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
  /** Latest permitted session finish, including all estimated sequence overhead. */
  schedulingEndMs?: number
  precipitationHourStartMs?: number
  severePrecipitationHourStartMs?: number
  severePrecipitationProbability?: number
  globalHardBlocked?: boolean
  globalHardBlockReason?: string
  reason?: string
}

/** Final forecast check before handing a fresh sequence to NINA. */
export function deliveryWeatherBlockReason(
  weather: TonightWeatherIntervalsResult,
  startMs: number,
  durationSeconds: number
): string | null {
  if (weather.status !== 'ok') return weather.reason ?? 'Weather forecast unavailable.'
  if (weather.globalHardBlocked) return weather.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'
  if (!Number.isFinite(startMs) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 'Session has no valid planned duration.'
  }
  const endMs = startMs + durationSeconds * 1000
  if (endMs > (weather.schedulingEndMs ?? weather.nightEndMs ?? 0)) {
    return 'Session cannot finish at least 2 hours before forecast precipitation or before nautical dawn.'
  }
  if (!weatherCoverageOk(weather.permittedIntervals, startMs, endMs, 0.8)) {
    return 'Weather-permitted coverage is below 80% for the session after the latest forecast.'
  }
  return null
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
  nowMs = Date.now(),
  schedulingWindow?: { startMs: number; endMs: number }
): Promise<TonightWeatherIntervalsResult> {
  if (!Number.isFinite(sunsetSec) || !Number.isFinite(sunriseSec) || sunriseSec <= sunsetSec) {
    return { status: 'unknown', permittedIntervals: [], reason: 'Invalid forecast night bounds' }
  }
  const nightStartMs = schedulingWindow?.startMs ?? sunsetSec * 1000
  const nightEndMs = schedulingWindow?.endMs ?? sunriseSec * 1000
  if (!Number.isFinite(nightStartMs) || !Number.isFinite(nightEndMs) || nightEndMs <= nightStartMs) {
    return { status: 'unknown', permittedIntervals: [], reason: 'Invalid scheduling night bounds' }
  }
  const nightSamples = samples
    .filter((sample) => sample.hourStartSec * 1000 < nightEndMs && (sample.hourStartSec + 3600) * 1000 > nightStartMs)
    .sort((a, b) => a.hourStartSec - b.hourStartSec)
  if (nightSamples.length === 0) {
    return { status: 'unknown', permittedIntervals: [], reason: 'No forecast samples for tonight window' }
  }
  const beforeNight = nowMs < nightStartMs
  const checkedHours = nightSamples.filter((h) => beforeNight || (h.hourStartSec + 3600) * 1000 > nowMs)
  const severePrecipitationHour = findNightwideSeverePrecipitationHour(samples, sunsetSec, sunriseSec)
  const precipitationHour = checkedHours.find((h) =>
    !Number.isFinite(h.precipProbability) || h.precipProbability >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY
  )
  const precipitationHourStartMs = precipitationHour ? precipitationHour.hourStartSec * 1000 : undefined
  const schedulingEndMs = Math.min(
    nightEndMs,
    precipitationHourStartMs == null
      ? nightEndMs
      : precipitationHourStartMs - FORECAST_PRECIPITATION_FINISH_BUFFER_MS
  )
  const permittedIntervals = nightSamples
    .filter(isHourWeatherPermitted)
    .map((h) => ({
      startMs: Math.max(h.hourStartSec * 1000, nightStartMs),
      endMs: Math.min((h.hourStartSec + 3600) * 1000, schedulingEndMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
  let clearRunStart: number | null = null
  let clearRunEnd = 0
  let hasClearRun = false
  for (const iv of permittedIntervals) {
    const start = Math.max(iv.startMs, nowMs, nightStartMs)
    if (iv.endMs <= start) continue
    if (clearRunStart == null || start > clearRunEnd) clearRunStart = start
    clearRunEnd = iv.endMs
    if (clearRunEnd - clearRunStart >= MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS * 3600_000) {
      hasClearRun = true
      break
    }
  }
  const usableHours = checkedHours.filter((h) =>
    h.hourStartSec * 1000 < schedulingEndMs && (h.hourStartSec + 3600) * 1000 > Math.max(nowMs, nightStartMs)
  )
  const highWindHours = usableHours.filter((h) => !Number.isFinite(h.windSpeedMs) || h.windSpeedMs > TONIGHT_WEATHER_MAX_WIND_MS).length
  const globalHardBlocked = severePrecipitationHour != null || highWindHours > 3 || !hasClearRun

  return {
    status: 'ok',
    permittedIntervals,
    nightStartMs,
    nightEndMs,
    schedulingEndMs,
    precipitationHourStartMs,
    severePrecipitationHourStartMs: severePrecipitationHour == null ? undefined : severePrecipitationHour.hourStartSec * 1000,
    severePrecipitationProbability: severePrecipitationHour?.precipProbability,
    globalHardBlocked,
    globalHardBlockReason: globalHardBlocked
      ? severePrecipitationHour
        ? `Global weather trigger: precipitation probability ${severePrecipitationHour.precipProbability}% at ${localHourLabel(severePrecipitationHour.hourStartSec, timeZone)} is at least 80% during the sunset-to-sunrise night. Entire night blocked.`
        : highWindHours > 3
        ? globalWeatherBlockReason(usableHours, timeZone, nowMs)
        : precipitationHour
          ? `Global weather trigger: no 2-hour clear run ends at least 2 hours before precipitation ≥${TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY}% at ${localHourLabel(precipitationHour.hourStartSec, timeZone)}.`
          : globalWeatherBlockReason(usableHours, timeZone, nowMs)
      : '',
  }
}

/**
 * Rule: precipitation probability >=80% in any sunset-to-sunrise forecast hour blocks the night.
 * Otherwise, current site's nautical dusk -> nautical dawn schedule needs a continuous
 * MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS passing hourly weather checks, a two-hour finish buffer
 * before precipitation >=10%, and no more than three usable high-wind hours.
 *
 * Forward-looking global gate: before sunset, all forecast night hours count. After sunset (already
 * in night), hours that have fully ended (hour end <= now) do not count toward (1)-(3) — only
 * remaining night matters, so a bad hour in the past cannot veto the rest of the night.
 */
export async function evaluateTonightWeatherGate(): Promise<TonightWeatherGateResult> {
  const intervals = await getTonightWeatherPermittedIntervals()
  if (intervals.status !== 'ok') {
    return { status: 'unknown', reason: intervals.reason ?? 'Weather forecast unavailable' }
  }
  return {
    status: intervals.globalHardBlocked ? 'not_permitted' : 'permitted',
    reason: intervals.globalHardBlocked
      ? intervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'
      : 'At least two continuous weather-permitted hours remain before the forecast precipitation cutoff.',
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
    const schedulingWindow = getTonightSchedulingWindow(new Date(), site)
    return getTonightWeatherPermittedIntervalsFromSamples(
      samples,
      nightBounds.sunsetSec,
      nightBounds.sunriseSec,
      site.timezone,
      Date.now(),
      {
        startMs: schedulingWindow.nauticalDuskUtc.getTime(),
        endMs: schedulingWindow.nauticalDawnUtc.getTime(),
      }
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
    '&daily=sunrise,sunset' +
    `&past_days=1&forecast_days=2&timezone=${site.timezone}&timeformat=unixtime`
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
    const nightBounds = pickOpenMeteoImagingNightBounds(data.daily?.sunset ?? [], data.daily?.sunrise ?? [])
    if (!nightBounds) return { ok: false, reason: 'Sunset-to-sunrise forecast bounds unavailable.' }
    const severePrecipitationHour = findNightwideSeverePrecipitationHour(
      times.map((hourStartSec, i) => ({ hourStartSec, precipProbability: Number(precip[i]) })),
      nightBounds.sunsetSec,
      nightBounds.sunriseSec
    )
    if (severePrecipitationHour) {
      return {
        ok: false,
        reason: `Global weather trigger: precipitation probability ${severePrecipitationHour.precipProbability}% at ${localHourLabel(severePrecipitationHour.hourStartSec, site.timezone)} is at least 80% during the sunset-to-sunrise night. Entire night blocked.`,
      }
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
 * Admin force-run weather gate: nightwide severe precipitation plus precipitation in the session window.
 * Cloud cover (and the night-wide global hard block that includes cloud runs) are ignored —
 * operators may force-run under cloudy skies when rain stays below 10% for every overlapping hour.
 */
export async function validateAdminRunWeatherWindow(
  startMs: number,
  endMs: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return sessionWindowHourlyPrecipOk(startMs, endMs)
}
