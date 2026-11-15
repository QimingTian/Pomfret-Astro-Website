import {
  fetchSevenTimerAstroSeries,
  parseSevenTimerInitUtc,
  type SevenTimerAstroSeries,
} from '@/lib/astro-conditions'
import { currentObservatorySite } from '@/lib/observatory-site-scope'
import type { ObservatorySite } from '@/lib/observatory-sites'
import { getTonightScheduleWindowSec } from '@/lib/schedule-strip'

export type AstroTimelineBlock = {
  startIndex: number
  span: number
  transparencyScale: number | null
  seeingScale: number | null
}

export type AstroTimelineHour = {
  hourStartSec: number
  label: string
  cloudCover: number | null
  precipProb: number | null
  windKmh: number | null
  seeingScale: number | null
  transparencyScale: number | null
}

export type AstroForecastSnapshot = {
  ok: boolean
  current: {
    tempC: number | null
    humidity: number | null
    cloudCover: number | null
    windKmh: number | null
    timeSec?: number | null
    feelsLikeC?: number | null
    dewPointC?: number | null
    cloudLow?: number | null
    cloudMid?: number | null
    cloudHigh?: number | null
    windGustKmh?: number | null
    windDirectionDeg?: number | null
    precipitationMm?: number | null
    rainMm?: number | null
    snowfallCm?: number | null
    pressureHpa?: number | null
    visibilityM?: number | null
  }
  hours: AstroTimelineHour[]
  astroBlocks: AstroTimelineBlock[]
  error?: string
}

type OpenMeteoResponse = {
  current?: {
    time?: number
    temperature_2m?: number
    relative_humidity_2m?: number
    cloud_cover?: number
    wind_speed_10m?: number
    apparent_temperature?: number
    dew_point_2m?: number
    cloud_cover_low?: number
    cloud_cover_mid?: number
    cloud_cover_high?: number
    wind_gusts_10m?: number
    wind_direction_10m?: number
    precipitation?: number
    rain?: number
    snowfall?: number
    pressure_msl?: number
    visibility?: number
  }
  hourly?: {
    time?: number[]
    cloud_cover?: number[]
    precipitation_probability?: number[]
    wind_speed_10m?: number[]
  }
}

function hourLabel(sec: number, timeZone: string): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function asScale(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 1 || v > 8) return null
  return v
}

function sevenTimerPointSec(series: SevenTimerAstroSeries, timepoint: number): number | null {
  const init = parseSevenTimerInitUtc(series.init)
  if (!init) return null
  return Math.floor(init.getTime() / 1000) + timepoint * 3600
}

function matchSevenTimerEntry(
  series: SevenTimerAstroSeries,
  hourStartSec: number
): { seeing: number | null; transparency: number | null } | null {
  for (const entry of series.dataseries) {
    const tp = entry.timepoint
    if (typeof tp !== 'number' || !Number.isFinite(tp)) continue
    const start = sevenTimerPointSec(series, tp)
    if (start == null) continue
    if (hourStartSec >= start && hourStartSec < start + 3 * 3600) {
      return {
        seeing: asScale(entry.seeing),
        transparency: asScale(entry.transparency),
      }
    }
  }
  return null
}

function assignSevenTimerBlocks(
  hours: AstroTimelineHour[],
  series: SevenTimerAstroSeries | null
): { hours: AstroTimelineHour[]; blocks: AstroTimelineBlock[] } {
  if (!hours.length || !series) return { hours, blocks: [] }

  const hoursWithAstro = hours.map((h) => {
    const match = matchSevenTimerEntry(series, h.hourStartSec)
    if (!match) return h
    return {
      ...h,
      seeingScale: match.seeing,
      transparencyScale: match.transparency,
    }
  })

  const blocks: AstroTimelineBlock[] = []
  let i = 0
  while (i < hoursWithAstro.length) {
    const sec = hoursWithAstro[i]!.hourStartSec
    const match = matchSevenTimerEntry(series, sec)
    const blockEndSec = match
      ? (() => {
          for (const entry of series.dataseries) {
            const tp = entry.timepoint
            if (typeof tp !== 'number') continue
            const start = sevenTimerPointSec(series, tp)
            if (start != null && sec >= start && sec < start + 3 * 3600) {
              return start + 3 * 3600
            }
          }
          return sec + 3600
        })()
      : sec + 3600

    let span = 0
    while (i + span < hoursWithAstro.length && hoursWithAstro[i + span]!.hourStartSec < blockEndSec) {
      span += 1
    }
    if (span < 1) span = 1

    blocks.push({
      startIndex: i,
      span,
      transparencyScale: match?.transparency ?? null,
      seeingScale: match?.seeing ?? null,
    })
    i += span
  }

  return { hours: hoursWithAstro, blocks }
}

async function fetchOpenMeteo(site: ObservatorySite): Promise<OpenMeteoResponse> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${site.weatherLat}&longitude=${site.weatherLon}` +
    '&current=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,apparent_temperature,dew_point_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_gusts_10m,wind_direction_10m,precipitation,rain,snowfall,pressure_msl,visibility' +
    '&hourly=cloud_cover,precipitation_probability,wind_speed_10m' +
    '&daily=sunrise,sunset&forecast_days=2&timezone=auto&timeformat=unixtime'

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Open-Meteo forecast unavailable')
  return (await res.json()) as OpenMeteoResponse
}

export async function fetchAstroForecast(site?: ObservatorySite): Promise<AstroForecastSnapshot> {
  const observatory = site ?? currentObservatorySite()
  try {
    const [openMeteo, sevenTimer] = await Promise.all([
      fetchOpenMeteo(observatory),
      fetchSevenTimerAstroSeries(),
    ])

    const times = openMeteo.hourly?.time ?? []
    const clouds = openMeteo.hourly?.cloud_cover ?? []
    const precip = openMeteo.hourly?.precipitation_probability ?? []
    const wind = openMeteo.hourly?.wind_speed_10m ?? []

    const { startSec: windowStartSec, endSec: windowEndSec } = getTonightScheduleWindowSec(
      new Date(),
      observatory
    )

    const nightIndices: number[] = []
    for (let i = 0; i < times.length; i += 1) {
      if (times[i]! >= windowStartSec && times[i]! < windowEndSec) nightIndices.push(i)
    }

    const hours: AstroTimelineHour[] = nightIndices.map((i) => {
      const sec = times[i]!
      return {
        hourStartSec: sec,
        label: hourLabel(sec, observatory.timezone),
        cloudCover: Number.isFinite(Number(clouds[i])) ? Number(clouds[i]) : null,
        precipProb: Number.isFinite(Number(precip[i])) ? Number(precip[i]) : null,
        windKmh: Number.isFinite(Number(wind[i])) ? Number(wind[i]) : null,
        seeingScale: null,
        transparencyScale: null,
      }
    })

    const withAstro = assignSevenTimerBlocks(hours, sevenTimer)

    return {
      ok: true,
      current: {
        timeSec: openMeteo.current?.time ?? null,
        tempC: openMeteo.current?.temperature_2m ?? null,
        humidity: openMeteo.current?.relative_humidity_2m ?? null,
        cloudCover: openMeteo.current?.cloud_cover ?? null,
        windKmh: openMeteo.current?.wind_speed_10m ?? null,
        feelsLikeC: openMeteo.current?.apparent_temperature ?? null,
        dewPointC: openMeteo.current?.dew_point_2m ?? null,
        cloudLow: openMeteo.current?.cloud_cover_low ?? null,
        cloudMid: openMeteo.current?.cloud_cover_mid ?? null,
        cloudHigh: openMeteo.current?.cloud_cover_high ?? null,
        windGustKmh: openMeteo.current?.wind_gusts_10m ?? null,
        windDirectionDeg: openMeteo.current?.wind_direction_10m ?? null,
        precipitationMm: openMeteo.current?.precipitation ?? null,
        rainMm: openMeteo.current?.rain ?? null,
        snowfallCm: openMeteo.current?.snowfall ?? null,
        pressureHpa: openMeteo.current?.pressure_msl ?? null,
        visibilityM: openMeteo.current?.visibility ?? null,
      },
      hours: withAstro.hours,
      astroBlocks: withAstro.blocks,
    }
  } catch (ex) {
    return {
      ok: false,
      current: { tempC: null, humidity: null, cloudCover: null, windKmh: null },
      hours: [],
      astroBlocks: [],
      error: ex instanceof Error ? ex.message : 'Forecast unavailable',
    }
  }
}

/** Color scale for metric cells: green / yellow / red */
export function astroForecastMetricColor(
  metric: 'cloud' | 'seeing' | 'transparency' | 'wind' | 'precip',
  value: number | null
): string {
  if (value == null || !Number.isFinite(value)) return 'rgba(255,255,255,0.12)'
  switch (metric) {
    case 'cloud':
      if (value < 20) return '#22c55e'
      if (value < 50) return '#eab308'
      return '#ef4444'
    case 'precip':
      if (value < 10) return '#22c55e'
      if (value < 30) return '#eab308'
      return '#ef4444'
    case 'wind':
      if (value < 15) return '#22c55e'
      if (value < 25) return '#eab308'
      return '#ef4444'
    case 'seeing':
    case 'transparency':
      if (value <= 2) return '#22c55e'
      if (value <= 4) return '#eab308'
      return '#ef4444'
    default:
      return 'rgba(255,255,255,0.12)'
  }
}
