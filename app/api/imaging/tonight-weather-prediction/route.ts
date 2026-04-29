import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type OpenMeteoHourly = {
  time?: number[]
  cloud_cover?: number[]
  precipitation_probability?: number[]
  wind_speed_10m?: number[]
  /** 0 = night, 1 = day (Open-Meteo); used so “after midnight before sunrise” counts as night. */
  is_day?: number[]
}

type OpenMeteoResponse = {
  hourly?: OpenMeteoHourly
  daily?: {
    sunrise?: number[]
    sunset?: number[]
  }
}

const LAT = 41.9159
const LON = -71.9626
const KMH_TO_MS = 1 / 3.6

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const startSecParam = requestUrl.searchParams.get('startSec')
  const endSecParam = requestUrl.searchParams.get('endSec')
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${LAT}&longitude=${LON}` +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m,is_day' +
    '&daily=sunrise,sunset' +
    '&forecast_days=2&timezone=America/New_York&timeformat=unixtime'

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
    const isDay = hourly?.is_day ?? []
    const dailySunrise = data.daily?.sunrise ?? []
    const dailySunset = data.daily?.sunset ?? []

    if (
      times.length === 0 ||
      clouds.length !== times.length ||
      precipProb.length !== times.length ||
      windSpeed.length !== times.length ||
      (isDay.length > 0 && isDay.length !== times.length)
    ) {
      return NextResponse.json({ ok: false as const, error: 'Forecast data is incomplete' }, { status: 502 })
    }
    if (dailySunset.length < 1 || dailySunrise.length < 2) {
      return NextResponse.json({ ok: false as const, error: 'Daily sunrise/sunset data is incomplete' }, { status: 502 })
    }

    // Strict "tonight" window from caller when provided (Remote schedule window).
    // Fallback to today's sunset -> tomorrow sunrise.
    const parsedStartSec = startSecParam ? Number(startSecParam) : NaN
    const parsedEndSec = endSecParam ? Number(endSecParam) : NaN
    const hasExternalWindow =
      Number.isFinite(parsedStartSec) &&
      Number.isFinite(parsedEndSec) &&
      parsedEndSec > parsedStartSec
    const windowStartSec = hasExternalWindow ? parsedStartSec : dailySunset[0]
    const windowEndSec = hasExternalWindow ? parsedEndSec : dailySunrise[1]
    if (!Number.isFinite(windowStartSec) || !Number.isFinite(windowEndSec) || windowEndSec <= windowStartSec) {
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
    const notPermittedHourReasons: Array<{ hourStartSec: number; reasons: Array<'cloud' | 'rain' | 'wind'> }> = []
    for (const i of nightIndices) {
      const cloud = Number(clouds[i])
      const precip = Number(precipProb[i])
      const windRaw = Number(windSpeed[i])
      const wind = Number.isFinite(windRaw) ? windRaw * KMH_TO_MS : Number.NaN
      const reasons: Array<'cloud' | 'rain' | 'wind'> = []
      if (!Number.isFinite(cloud) || cloud >= 10) reasons.push('cloud')
      if (!Number.isFinite(precip) || precip >= 10) reasons.push('rain')
      if (!Number.isFinite(wind) || wind > 10) reasons.push('wind')
      if (Number.isFinite(cloud) && Number.isFinite(precip) && Number.isFinite(wind) && cloud < 10 && precip < 10 && wind <= 10) {
        readyHourStartsSec.push(times[i])
      } else {
        notPermittedHourReasons.push({ hourStartSec: times[i], reasons })
      }
    }
    // For "clear all session blocks" gating, only evaluate the physical night
    // window (today sunset -> tomorrow sunrise), not the wider schedule window.
    const precipCheckStartSec = dailySunset[0]
    const precipCheckEndSec = dailySunrise[1]
    const precipCheckIndices: number[] = []
    if (
      Number.isFinite(precipCheckStartSec) &&
      Number.isFinite(precipCheckEndSec) &&
      precipCheckEndSec > precipCheckStartSec
    ) {
      for (let i = 0; i < times.length; i += 1) {
        if (times[i] >= precipCheckStartSec && times[i] < precipCheckEndSec) {
          precipCheckIndices.push(i)
        }
      }
    }

    const precipitationHits = (precipCheckIndices.length > 0 ? precipCheckIndices : nightIndices)
      .map((i) => {
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

    // Old check used only [today sunset → tomorrow sunrise]. After local midnight but before
    // "today's" sunset, that window has not started yet, so 1am looked like "day" and returned
    // not_permitted. Prefer Open-Meteo hourly is_day when present; else fall back to sunset window.
    let isNighttimeNow = nowSec >= windowStartSec && nowSec < windowEndSec
    if (isDay.length === times.length) {
      let idx = -1
      for (let i = 0; i < times.length; i += 1) {
        if (times[i] <= nowSec) idx = i
        else break
      }
      if (idx >= 0) {
        isNighttimeNow = Number(isDay[idx]) === 0
      }
    } else {
      // No is_day: same bug as before for 1am — at least treat “before today’s sunrise” as night.
      const todaySunrise = dailySunrise[0]
      isNighttimeNow =
        nowSec < todaySunrise ||
        (nowSec >= windowStartSec && nowSec < windowEndSec)
    }
    if (isNighttimeNow) {
      return NextResponse.json({
        ok: true as const,
        prediction: 'unavailable',
        message: 'nighttime now, prediction not available',
        readyHourStartsSec,
        nightHourStartsSec,
        notPermittedHourReasons,
        hasAnyPrecipitationTonight,
        precipitationHits,
      })
    }

    let permitted = false
    if (nightIndices.length > 0) {
      let allNightPrecipUnder10 = true
      let windOver10HourCount = 0
      for (const i of nightIndices) {
        const p = Number(precipProb[i])
        if (!Number.isFinite(p) || p >= 10) {
          allNightPrecipUnder10 = false
        }
        const windRaw = Number(windSpeed[i])
        const w = Number.isFinite(windRaw) ? windRaw * KMH_TO_MS : Number.NaN
        if (!Number.isFinite(w) || w > 10) {
          windOver10HourCount += 1
        }
      }
      const windAllowedByHours = windOver10HourCount <= 3

      let consecutiveUnder10 = 0
      let hasFourConsecutiveUnder10 = false
      if (allNightPrecipUnder10 && windAllowedByHours) {
        for (const i of nightIndices) {
          const c = Number(clouds[i])
          if (c < 10) {
            consecutiveUnder10 += 1
            if (consecutiveUnder10 >= 4) {
              hasFourConsecutiveUnder10 = true
              break
            }
          } else {
            consecutiveUnder10 = 0
          }
        }
      }

      permitted = allNightPrecipUnder10 && windAllowedByHours && hasFourConsecutiveUnder10
    }

    return NextResponse.json({
      ok: true as const,
      prediction: permitted ? 'permitted' : 'not_permitted',
      permitted,
      readyHourStartsSec,
      nightHourStartsSec,
      notPermittedHourReasons,
      hasAnyPrecipitationTonight,
      precipitationHits,
      rule:
        "Tonight (today sunset → tomorrow sunrise, Pomfret): (1) some run of 4 consecutive hours with cloud_cover < 10%; " +
        '(2) every hour precipitation_probability < 10%; (3) hours with wind_speed_10m > 10 m/s must be <= 3.',
    })
  } catch (error) {
    console.error('[tonight-weather-prediction] failed', error)
    return NextResponse.json({ ok: false as const, error: 'Unable to evaluate weather prediction' }, { status: 500 })
  }
}
