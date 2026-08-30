import {
  getTonightScheduleEveningAstronomyUtc,
  getTonightScheduleMorningAstronomyUtc,
  observatoryLocalCalendarAnchorUtc,
} from '@/lib/sunrise-window'
import { currentObservatorySite } from '@/lib/observatory-site-scope'
import type { ObservatorySite } from '@/lib/observatory-sites'

/** Matches Remote “tonight” strip: observatory-local startHour → next day endHour. */
export type TonightScheduleStrip = {
  nightKey: string
  windowStartMs: number
  windowEndMs: number
  schedulingDeadlineMs: number
  nauticalDuskMs: number
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((current - start) / 86400000) + 1
}

/** Approximate UTC instant for `y-m-d hour:minute` in an IANA timezone. */
export function zonedWallTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(new Date(utcGuess))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return utcGuess - (asUtc - utcGuess)
}

function sunriseUtcForSiteCalendarDay(anchorUtcMidnight: Date, site: ObservatorySite): Date {
  const n = dayOfYearUTC(anchorUtcMidnight)
  const gamma = (2 * Math.PI / 365) * (n - 1)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  const latRad = degToRad(site.observerLatDeg)
  const zenithRad = degToRad(90.833)
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl))
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngleDeg = radToDeg(Math.acos(clamped))
  const solarNoonMin = 720 - 4 * site.observerLonDeg - eqTime
  const eventMin = solarNoonMin - 4 * hourAngleDeg
  const midnightUtc = Date.UTC(
    anchorUtcMidnight.getUTCFullYear(),
    anchorUtcMidnight.getUTCMonth(),
    anchorUtcMidnight.getUTCDate()
  )
  return new Date(midnightUtc + eventMin * 60000)
}

export function getTonightScheduleStrip(
  now = new Date(),
  site: ObservatorySite = currentObservatorySite()
): TonightScheduleStrip {
  const startHour = site.scheduleStripStartHour
  const endHour = site.scheduleStripEndHour
  const todayAnchor = observatoryLocalCalendarAnchorUtc(now, site)
  const todaySunrise = sunriseUtcForSiteCalendarDay(todayAnchor, site)
  const y0 = todayAnchor.getUTCFullYear()
  const m0 = todayAnchor.getUTCMonth() + 1
  const d0 = todayAnchor.getUTCDate()

  let startMs = zonedWallTimeToUtcMs(site.timezone, y0, m0, d0, startHour, 0, 0)
  if (now.getTime() < todaySunrise.getTime()) {
    const prev = new Date(Date.UTC(y0, m0 - 1, d0 - 1))
    startMs = zonedWallTimeToUtcMs(
      site.timezone,
      prev.getUTCFullYear(),
      prev.getUTCMonth() + 1,
      prev.getUTCDate(),
      startHour,
      0,
      0
    )
  }

  const startLocal = new Date(startMs)
  const startParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: site.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startLocal)
  const [sy, sm, sd] = startParts.split('-').map(Number)
  const nextDay = new Date(Date.UTC(sy!, sm! - 1, sd! + 1))
  const endMs = zonedWallTimeToUtcMs(
    site.timezone,
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    endHour,
    0,
    0
  )
  const nightKey = `${sy}-${String(sm).padStart(2, '0')}-${String(sd).padStart(2, '0')}`

  const { nauticalDuskUtc } = getTonightScheduleEveningAstronomyUtc(now, site)
  const { astronomicalDawnUtc } = getTonightScheduleMorningAstronomyUtc(now, site)
  const schedulingDeadlineMs = Math.min(endMs, astronomicalDawnUtc.getTime())

  return {
    nightKey,
    windowStartMs: startMs,
    windowEndMs: endMs,
    schedulingDeadlineMs,
    nauticalDuskMs: nauticalDuskUtc.getTime(),
  }
}

/** Same window as Remote / Atlas weather ribbon (unix seconds). */
export function getTonightScheduleWindowSec(
  now = new Date(),
  site?: ObservatorySite
): { startSec: number; endSec: number } {
  const strip = getTonightScheduleStrip(now, site ?? currentObservatorySite())
  return {
    startSec: Math.floor(strip.windowStartMs / 1000),
    endSec: Math.floor(strip.windowEndMs / 1000),
  }
}

/** Global “Tonight’s weather prediction” headline — only meaningful before nautical dusk. */
export function isBeforeTonightWeatherHeadline(now = new Date(), site?: ObservatorySite): boolean {
  const strip = getTonightScheduleStrip(now, site ?? currentObservatorySite())
  return now.getTime() < strip.nauticalDuskMs
}
