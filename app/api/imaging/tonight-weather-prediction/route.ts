import { NextResponse } from 'next/server'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import {
  maybeReconcileQueueWhenScheduleWeatherColumnChanged,
  type ScheduleWeatherColumnPayload,
} from '@/lib/imaging-queue-weather-column-reconcile'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  evaluateGlobalTonightWeatherPermitted,
  MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS,
  pickOpenMeteoImagingNightBounds,
  type HourlyForecastSample,
  type WeatherNotPermittedReason,
  weatherNotPermittedReasons,
} from '@/lib/tonight-weather-gate'
import { observatorySiteFromSearchParams } from '@/lib/observatory-sites'

export const runtime = 'nodejs'

type OpenMeteoHourly = {
  time?: number[]
  cloud_cover?: number[]
  precipitation_probability?: number[]
  wind_speed_10m?: number[]
}

type OpenMeteoResponse = {
  hourly?: OpenMeteoHourly
  daily?: {
    sunrise?: number[]
    sunset?: number[]
  }
}

const KMH_TO_MS = 1 / 3.6

async function reconcileIfScheduleWeatherColumnChanged(
  windowStartSec: number,
  windowEndSec: number,
  payload: ScheduleWeatherColumnPayload
): Promise<void> {
  try {
    await maybeReconcileQueueWhenScheduleWeatherColumnChanged(
      windowStartSec,
      windowEndSec,
      payload
    )
  } catch (error) {
    console.error('[tonight-weather-prediction] weather reconcile failed', error)
  }
}

export async function GET(request: Request) {
  return runWithRequestSite(request, async () => {
  const requestUrl = new URL(request.url)
  const site = observatorySiteFromSearchParams(requestUrl.searchParams)
  const startSecParam = requestUrl.searchParams.get('startSec')
  const endSecParam = requestUrl.searchParams.get('endSec')
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${site.weatherLat}&longitude=${site.weatherLon}` +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m' +
    '&daily=sunrise,sunset' +
    `&past_days=1&forecast_days=2&timezone=${site.timezone}&timeformat=unixtime`

  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      return NextResponse.json({ ok: false as const, error: 'Failed to fetch weather forecast' }, { status: 502 })
    }
    const data = (await response.json()) as OpenMeteoResponse
    const hourly = data.hourly
    const times = hourly?.time ?? []
    const clouds = hourly?.cloud_cover ?? []
    const precipProb = hourly?.precipitation_probability ?? []
    const windSpeed = hourly?.wind_speed_10m ?? []
    const dailySunrise = data.daily?.sunrise ?? []
    const dailySunset = data.daily?.sunset ?? []

    if (
      times.length === 0 ||
      clouds.length !== times.length ||
      precipProb.length !== times.length ||
      windSpeed.length !== times.length
    ) {
      return NextResponse.json({ ok: false as const, error: 'Forecast data is incomplete' }, { status: 502 })
    }
    if (dailySunset.length < 1 || dailySunrise.length < 2) {
      return NextResponse.json({ ok: false as const, error: 'Daily sunrise/sunset data is incomplete' }, { status: 502 })
    }

    // Strict "tonight" window from caller when provided (Remote schedule window).
    // Fallback: imaging night that contains now (previous evening → this morning after midnight).
    const parsedStartSec = startSecParam ? Number(startSecParam) : NaN
    const parsedEndSec = endSecParam ? Number(endSecParam) : NaN
    const hasExternalWindow =
      Number.isFinite(parsedStartSec) &&
      Number.isFinite(parsedEndSec) &&
      parsedEndSec > parsedStartSec
    const pickedNight = pickOpenMeteoImagingNightBounds(dailySunset, dailySunrise)
    const fallbackStart = pickedNight?.sunsetSec
    const fallbackEnd = pickedNight?.sunriseSec
    const windowStartSec = hasExternalWindow ? parsedStartSec : fallbackStart
    const windowEndSec = hasExternalWindow ? parsedEndSec : fallbackEnd
    if (
      windowStartSec == null ||
      windowEndSec == null ||
      !Number.isFinite(windowStartSec) ||
      !Number.isFinite(windowEndSec) ||
      windowEndSec <= windowStartSec
    ) {
      return NextResponse.json({ ok: false as const, error: 'Invalid tonight window from forecast data' }, { status: 502 })
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const nightIndices: number[] = []
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] >= windowStartSec && times[i] < windowEndSec) {
        nightIndices.push(i)
      }
    }
    const nightHourStartsSec = nightIndices.map((i) => times[i])

    const readyHourStartsSec: number[] = []
    const notPermittedHourReasons: Array<{ hourStartSec: number; reasons: WeatherNotPermittedReason[] }> = []
    for (const i of nightIndices) {
      const cloud = Number(clouds[i])
      const precip = Number(precipProb[i])
      const windRaw = Number(windSpeed[i])
      const wind = Number.isFinite(windRaw) ? windRaw * KMH_TO_MS : Number.NaN
      const reasons = weatherNotPermittedReasons({
        cloudCover: cloud,
        precipProbability: precip,
        windSpeedMs: wind,
      })
      if (reasons.length === 0) {
        readyHourStartsSec.push(times[i])
      } else {
        notPermittedHourReasons.push({ hourStartSec: times[i], reasons })
      }
    }
    const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(new Date(), site)
    const globalGateStartSec = Math.floor(nauticalDuskUtc.getTime() / 1000)
    const globalGateEndSec = Math.floor(nauticalDawnUtc.getTime() / 1000)

    const precipCheckIndices: number[] = []
    if (Number.isFinite(globalGateStartSec) && Number.isFinite(globalGateEndSec) && globalGateEndSec > globalGateStartSec) {
      for (let i = 0; i < times.length; i += 1) {
        if (times[i] >= globalGateStartSec && times[i] < globalGateEndSec) {
          precipCheckIndices.push(i)
        }
      }
    }

    const beforeGlobalGate = nowSec < globalGateStartSec
    const countsTowardGlobalNight = (i: number): boolean => {
      const t = times[i]
      const inGate = t >= globalGateStartSec && t < globalGateEndSec
      if (!inGate) return false
      const hourFullyEnded = t + 3600 <= nowSec
      return beforeGlobalGate || !hourFullyEnded
    }

    const precipitationHits = (precipCheckIndices.length > 0 ? precipCheckIndices : nightIndices)
      .map((i) => {
        if (!countsTowardGlobalNight(i)) return null
        const precip = Number(precipProb[i])
        const cloud = Number(clouds[i])
        if (!Number.isFinite(precip) || precip < 10) return null
        return {
          hourStartSec: times[i],
          precipitationProbability: precip,
          cloudCover: Number.isFinite(cloud) ? cloud : null,
        }
      })
      .filter((x): x is { hourStartSec: number; precipitationProbability: number; cloudCover: number | null } => x != null)
    const hasAnyPrecipitationTonight = precipitationHits.length > 0
    const precipitationHitHourStartsSec = precipitationHits.map((hit) => hit.hourStartSec)

    // Headline / global prediction is only meaningful before nautical dusk — same cutoff as
    // `isBeforeTonightWeatherHeadline`. Do not use Open-Meteo is_day (civil night): that flips
    // ~30–40 min earlier and made the UI show "Not permitted" while the dusk headline still showed.
    const strip = getTonightScheduleStrip(new Date(), site)
    const nauticalDuskSec = Math.floor(strip.nauticalDuskMs / 1000)
    const imagingNightUnderway =
      Number.isFinite(nauticalDuskSec) &&
      Number.isFinite(globalGateEndSec) &&
      nowSec >= nauticalDuskSec &&
      nowSec < globalGateEndSec

    if (imagingNightUnderway) {
      await reconcileIfScheduleWeatherColumnChanged(windowStartSec, windowEndSec, {
        prediction: 'unavailable',
        hasAnyPrecipitationTonight,
        readyHourStartsSec,
        nightHourStartsSec,
        notPermittedHourReasons,
        precipitationHitHourStartsSec,
      })
      return NextResponse.json({
        ok: true as const,
        prediction: 'unavailable',
        message: 'after nautical dusk, prediction not available',
        readyHourStartsSec,
        nightHourStartsSec,
        notPermittedHourReasons,
        hasAnyPrecipitationTonight,
        precipitationHits,
      })
    }

    const hourlySamples: HourlyForecastSample[] = times.map((hourStartSec, i) => {
      const windRaw = Number(windSpeed[i])
      return {
        hourStartSec,
        cloudCover: Number(clouds[i]),
        precipProbability: Number(precipProb[i]),
        windSpeedMs: Number.isFinite(windRaw) ? windRaw * KMH_TO_MS : Number.NaN,
      }
    })
    const permitted = evaluateGlobalTonightWeatherPermitted({
      hours: hourlySamples,
      gateStartSec: globalGateStartSec,
      gateEndSec: globalGateEndSec,
      nowSec,
    })

    const prediction = permitted ? 'permitted' : 'not_permitted'
    await reconcileIfScheduleWeatherColumnChanged(windowStartSec, windowEndSec, {
      prediction,
      hasAnyPrecipitationTonight,
      readyHourStartsSec,
      nightHourStartsSec,
      notPermittedHourReasons,
      precipitationHitHourStartsSec,
    })

    return NextResponse.json({
      ok: true as const,
      prediction,
      permitted,
      readyHourStartsSec,
      nightHourStartsSec,
      notPermittedHourReasons,
      hasAnyPrecipitationTonight,
      precipitationHits,
      rule:
        `Tonight (nautical dusk → nautical dawn, Pomfret): (1) some run of ${MIN_CONSECUTIVE_CLEAR_CLOUD_HOURS} consecutive hours passing hourly weather checks (cloud, precip, wind); ` +
        '(2) every hour precipitation_probability < 10%; (3) hours with wind_speed_10m > 10 m/s must be <= 3. ' +
        'After nautical dusk, only remaining imaging-night hours count for (1)–(3) (fully past hours are ignored). Pre-dusk schedule-strip hours do not count.',
    })
  } catch (error) {
    console.error('[tonight-weather-prediction] failed', error)
    return NextResponse.json({ ok: false as const, error: 'Unable to evaluate weather prediction' }, { status: 500 })
  }
  })
}
