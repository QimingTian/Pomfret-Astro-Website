const LAT = 41.9159
const LON = -71.9626
const KMH_TO_MS = 1 / 3.6

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
 * 1) some run of 4 consecutive hours with cloud_cover < 10%
 * 2) every hour precipitation_probability < 10%
 * 3) hours with wind_speed_10m > 10 m/s must be <= 3
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

export async function getTonightWeatherPermittedIntervals(): Promise<TonightWeatherIntervalsResult> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LAT}&longitude=${LON}` +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m' +
    '&daily=sunrise,sunset' +
    '&forecast_days=2&timezone=America/New_York&timeformat=unixtime'

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast unavailable' }
    }
    const data = (await res.json()) as OpenMeteoResponse
    const times = data.hourly?.time ?? []
    const clouds = data.hourly?.cloud_cover ?? []
    const precip = data.hourly?.precipitation_probability ?? []
    const wind = data.hourly?.wind_speed_10m ?? []
    const sunset = data.daily?.sunset?.[0]
    const sunrise = data.daily?.sunrise?.[1]
    if (
      !Number.isFinite(sunset) ||
      !Number.isFinite(sunrise) ||
      Number(sunrise) <= Number(sunset) ||
      times.length === 0 ||
      clouds.length !== times.length ||
      precip.length !== times.length ||
      wind.length !== times.length
    ) {
      return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast data incomplete' }
    }

    const nightStartMs = Number(sunset) * 1000
    const nightEndMs = Number(sunrise) * 1000
    const nightIndices: number[] = []
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] >= Number(sunset) && times[i] < Number(sunrise)) nightIndices.push(i)
    }
    if (nightIndices.length === 0) {
      return { status: 'unknown', permittedIntervals: [], reason: 'No forecast samples for tonight window' }
    }

    const permittedIntervals: TimeInterval[] = []
    let anyPrecipOver10 = false
    let windOver10Count = 0
    let consecutiveCloudUnder10 = 0
    let hasFourConsecutiveCloudUnder10 = false
    for (const i of nightIndices) {
      const c = Number(clouds[i])
      const p = Number(precip[i])
      const wKmh = Number(wind[i])
      const wMs = Number.isFinite(wKmh) ? wKmh * KMH_TO_MS : Number.NaN
      if (!Number.isFinite(p) || p >= 10) anyPrecipOver10 = true
      if (!Number.isFinite(wMs) || wMs > 10) windOver10Count += 1
      if (Number.isFinite(c) && c < 10) {
        consecutiveCloudUnder10 += 1
        if (consecutiveCloudUnder10 >= 4) hasFourConsecutiveCloudUnder10 = true
      } else {
        consecutiveCloudUnder10 = 0
      }
      const isPermitted = Number.isFinite(c) && c < 10 && Number.isFinite(p) && p < 10 && Number.isFinite(wMs) && wMs <= 10
      if (!isPermitted) continue
      const hourStartMs = times[i] * 1000
      const hourEndMs = hourStartMs + 60 * 60 * 1000
      const startMs = Math.max(hourStartMs, nightStartMs)
      const endMs = Math.min(hourEndMs, nightEndMs)
      if (endMs > startMs) permittedIntervals.push({ startMs, endMs })
    }
    const windTooMuch = windOver10Count > 3
    const cloudRunMissing = !hasFourConsecutiveCloudUnder10
    const globalHardBlocked = anyPrecipOver10 || windTooMuch || cloudRunMissing
    const globalHardBlockReason = anyPrecipOver10
      ? 'Global weather trigger: at least one night hour has precipitation probability >= 10%.'
      : windTooMuch
        ? 'Global weather trigger: more than 3 night hours have wind speed > 10 m/s.'
        : cloudRunMissing
          ? 'Global weather trigger: no 4-hour consecutive run with cloud cover < 10%.'
          : ''

    return {
      status: 'ok',
      permittedIntervals,
      nightStartMs,
      nightEndMs,
      globalHardBlocked,
      globalHardBlockReason,
    }
  } catch {
    return { status: 'unknown', permittedIntervals: [], reason: 'Weather forecast evaluation failed' }
  }
}
