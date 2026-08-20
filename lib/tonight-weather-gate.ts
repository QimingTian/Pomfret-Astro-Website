import { getAdminClosedWindowsInRange } from '@/lib/admin-closed-window-store'
import {
  astroConditionIsReady,
  astroConditionsForInstant,
  fetchSevenTimerAstroSeries,
  type AstroConditionScale,
  type SevenTimerAstroSeries,
} from '@/lib/astro-conditions'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'

const LAT = 41.9159
const LON = -71.9626
const KMH_TO_MS = 1 / 3.6

/** Global hard gate: require this many consecutive fully weather-permitted night hours. */
export const MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS = 2
export const TONIGHT_WEATHER_MAX_CLOUD_PERCENT = 10
export const TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY = 10
export const TONIGHT_WEATHER_MAX_WIND_MS = 10

export type WeatherNotPermittedReason = 'cloud' | 'rain' | 'wind' | 'transparency' | 'seeing'

export type HourWeatherSample = {
  cloudCover: number
  precipProbability: number
  windSpeedMs: number
  transparency?: AstroConditionScale | null
  seeing?: AstroConditionScale | null
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
  if (!astroConditionIsReady(sample.transparency)) reasons.push('transparency')
  if (!astroConditionIsReady(sample.seeing)) reasons.push('seeing')
  return reasons
}

export function isHourWeatherPermitted(sample: HourWeatherSample): boolean {
  return weatherNotPermittedReasons(sample).length === 0
}

export function astroForHourStartSec(
  series: SevenTimerAstroSeries | null,
  hourStartSec: number
): Pick<HourWeatherSample, 'transparency' | 'seeing'> {
  if (!series) return { transparency: null, seeing: null }
  return astroConditionsForInstant(series, new Date(hourStartSec * 1000))
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

/**
 * Rule (Pomfret tonight, sunset -> next sunrise):
 * 1) some run of MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS consecutive hours passing hourly weather checks
 *    (cloud, precip, wind, 7Timer transparency/seeing)
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
  // past_days=1 keeps yesterday's sunset after local midnight so the current imaging night
  // (previous evening → this morning) is still present in daily[].
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LAT}&longitude=${LON}` +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m' +
    '&daily=sunrise,sunset' +
    '&past_days=1&forecast_days=2&timezone=America/New_York&timeformat=unixtime'

  try {
    const [res, astroSeries] = await Promise.all([
      fetch(url, { cache: 'no-store' }),
      fetchSevenTimerAstroSeries(),
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

    const sunset = nightBounds.sunsetSec
    const sunrise = nightBounds.sunriseSec
    const nightStartMs = sunset * 1000
    const nightEndMs = sunrise * 1000
    const nightIndices: number[] = []
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] >= sunset && times[i] < sunrise) nightIndices.push(i)
    }
    if (nightIndices.length === 0) {
      return { status: 'unknown', permittedIntervals: [], reason: 'No forecast samples for tonight window' }
    }

    const nowMs = Date.now()
    const beforeAstroNight = nowMs < nightStartMs

    const permittedIntervals: TimeInterval[] = []
    let anyPrecipOver10 = false
    let windOver10Count = 0
    let consecutiveCloudUnder10 = 0
    let hasMinConsecutiveCloudClearRun = false
    for (const i of nightIndices) {
      const hourStartMs = times[i] * 1000
      const hourEndMs = hourStartMs + 60 * 60 * 1000
      const hourFullyEnded = hourEndMs <= nowMs
      const countsTowardGlobalHard = beforeAstroNight || !hourFullyEnded

      const c = Number(clouds[i])
      const p = Number(precip[i])
      const wKmh = Number(wind[i])
      const wMs = Number.isFinite(wKmh) ? wKmh * KMH_TO_MS : Number.NaN
      const astro = astroForHourStartSec(astroSeries, times[i])
      const hourSample: HourWeatherSample = {
        cloudCover: c,
        precipProbability: p,
        windSpeedMs: wMs,
        transparency: astro.transparency,
        seeing: astro.seeing,
      }
      if (countsTowardGlobalHard) {
        if (!Number.isFinite(p) || p >= TONIGHT_WEATHER_MAX_PRECIP_PROBABILITY) anyPrecipOver10 = true
        if (!Number.isFinite(wMs) || wMs > TONIGHT_WEATHER_MAX_WIND_MS) windOver10Count += 1
        if (isHourWeatherPermitted(hourSample)) {
          consecutiveCloudUnder10 += 1
          if (consecutiveCloudUnder10 >= MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS) {
            hasMinConsecutiveCloudClearRun = true
          }
        } else {
          consecutiveCloudUnder10 = 0
        }
      }
      if (!isHourWeatherPermitted(hourSample)) continue
      const startMs = Math.max(hourStartMs, nightStartMs)
      const endMs = Math.min(hourEndMs, nightEndMs)
      if (endMs > startMs) permittedIntervals.push({ startMs, endMs })
    }
    const windTooMuch = windOver10Count > 3
    const cloudRunMissing = !hasMinConsecutiveCloudClearRun
    const globalHardBlocked = anyPrecipOver10 || windTooMuch || cloudRunMissing
    const globalHardBlockReason = anyPrecipOver10
      ? 'Global weather trigger: at least one night hour has precipitation probability >= 10%.'
      : windTooMuch
        ? 'Global weather trigger: more than 3 night hours have wind speed > 10 m/s.'
        : cloudRunMissing
          ? `Global weather trigger: no ${MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS}-hour consecutive run passing hourly weather checks (cloud, precip, wind, transparency, seeing).`
          : ''

    let effectivePermittedIntervals: TimeInterval[] = [...permittedIntervals]
    try {
      const adminClosedWindows = await getAdminClosedWindowsInRange(nightStartMs, nightEndMs)
      for (const w of adminClosedWindows) {
        effectivePermittedIntervals = subtractOccupiedFromFree(effectivePermittedIntervals, w)
      }
    } catch {
      // If admin window store read fails, fall back to weather-only intervals.
    }

    return {
      status: 'ok',
      permittedIntervals: effectivePermittedIntervals,
      nightStartMs,
      nightEndMs,
      globalHardBlocked,
      globalHardBlockReason,
    }
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
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LAT}&longitude=${LON}` +
    '&hourly=precipitation_probability' +
    '&forecast_days=2&timezone=America/New_York&timeformat=unixtime'
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

/** Admin force-run: >=80% weather-permitted coverage and hourly precip < 10% over the session window. */
export async function validateAdminRunWeatherWindow(
  startMs: number,
  endMs: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const intervals = await getTonightWeatherPermittedIntervals()
  if (intervals.status !== 'ok') {
    return { ok: false, reason: intervals.reason ?? 'Weather forecast unavailable.' }
  }
  if (intervals.globalHardBlocked === true) {
    return {
      ok: false,
      reason: intervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.',
    }
  }
  if (!weatherCoverageOk(intervals.permittedIntervals, startMs, endMs, 0.8)) {
    return {
      ok: false,
      reason: 'Weather-permitted coverage is below 80% for this session window.',
    }
  }
  return sessionWindowHourlyPrecipOk(startMs, endMs)
}
