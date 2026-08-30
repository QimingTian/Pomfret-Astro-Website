import { POMFRET_SITE, type ObservatorySite } from '@/lib/observatory-sites'
import { currentObservatorySite } from '@/lib/observatory-site-scope'

/** @deprecated Pomfret alias — prefer `currentObservatorySite().timezone`. */
export const OBSERVATORY_TIME_ZONE = POMFRET_SITE.timezone

function siteOrCurrent(site?: ObservatorySite): ObservatorySite {
  return site ?? currentObservatorySite()
}

/**
 * UTC `Date` at 00:00:00 for the observatory's **local** civil calendar day containing `now`
 * (same Y-M-D as America/New_York wall date). Used as `solarEventUtcForDate` anchor so nautical
 * dawn/dusk match local evening; avoids treating UTC-midnight as “new day” while US evening
 * is still before local nautical dusk (which incorrectly cleared daytime-closed → Ready).
 */
export function observatoryLocalCalendarAnchorUtc(now: Date, site?: ObservatorySite): Date {
  const observatory = siteOrCurrent(site)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: observatory.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const formatted = formatter.format(now)
  const [y, m, d] = formatted.split('-').map((part) => Number(part))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }
  return new Date(Date.UTC(y, m - 1, d))
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

function solarEventUtcForDate(
  date: Date,
  zenithDeg: number,
  isSunrise: boolean,
  site?: ObservatorySite
): Date {
  const s = siteOrCurrent(site)
  const OBS_LAT_DEG = s.observerLatDeg
  const OBS_LON_DEG = s.observerLonDeg
  const n = dayOfYearUTC(date)
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

  const latRad = degToRad(OBS_LAT_DEG)
  const zenithRad = degToRad(zenithDeg)
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl))
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngleDeg = radToDeg(Math.acos(clamped))

  // NOAA: minutes from UTC midnight
  const solarNoonMin = 720 - 4 * OBS_LON_DEG - eqTime
  const eventMin = isSunrise ? solarNoonMin - 4 * hourAngleDeg : solarNoonMin + 4 * hourAngleDeg

  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return new Date(midnightUtc + eventMin * 60000)
}

function sunriseUtcForDate(date: Date, site?: ObservatorySite): Date {
  return solarEventUtcForDate(date, 90.833, true, site)
}

function sunsetUtcForDate(date: Date, site?: ObservatorySite): Date {
  return solarEventUtcForDate(date, 90.833, false, site)
}

function nauticalDawnUtcForDate(date: Date, site?: ObservatorySite): Date {
  return solarEventUtcForDate(date, 102, true, site)
}

function nauticalDuskUtcForDate(date: Date, site?: ObservatorySite): Date {
  return solarEventUtcForDate(date, 102, false, site)
}

/** Nautical dawn/dusk (UTC) and daytime-closed band (nautical dawn … nautical dusk) for observatory local day of `now`. */
export function getDaytimeClosedWindowDetail(now = new Date(), site?: ObservatorySite): {
  within: boolean
  nauticalDawnUtc: string
  nauticalDuskUtc: string
  sunriseUtc: string
  sunsetUtc: string
  closedStartUtc: string
  closedEndUtc: string
} {
  const today = observatoryLocalCalendarAnchorUtc(now, site)
  const nauticalDawn = nauticalDawnUtcForDate(today, site)
  const nauticalDusk = nauticalDuskUtcForDate(today, site)
  const sunrise = sunriseUtcForDate(today, site)
  const sunset = sunsetUtcForDate(today, site)
  const closedStart = nauticalDawn
  const closedEnd = nauticalDusk
  return {
    within: now >= closedStart && now <= closedEnd,
    nauticalDawnUtc: nauticalDawn.toISOString(),
    nauticalDuskUtc: nauticalDusk.toISOString(),
    sunriseUtc: sunrise.toISOString(),
    sunsetUtc: sunset.toISOString(),
    closedStartUtc: closedStart.toISOString(),
    closedEndUtc: closedEnd.toISOString(),
  }
}

export function isWithinDaytimeClosedWindow(now = new Date()): boolean {
  return getDaytimeClosedWindowDetail(now).within
}

export function nextSunriseUtc(now = new Date()): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const sunriseToday = sunriseUtcForDate(today)
  if (sunriseToday > now) return sunriseToday

  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return sunriseUtcForDate(tomorrow)
}

export function canFinishBeforeSunriseBuffer(
  exposureSeconds: number,
  count: number,
  now = new Date()
): { ok: boolean; requiredSeconds: number; secondsUntilDeadline: number; sunriseUtc: Date; deadlineUtc: Date } {
  const requiredSeconds = Math.max(0, exposureSeconds * count)
  const sunriseUtc = nextSunriseUtc(now)
  const deadlineUtc = new Date(sunriseUtc.getTime() - 60 * 60 * 1000) // 1h before sunrise
  const secondsUntilDeadline = (deadlineUtc.getTime() - now.getTime()) / 1000
  return {
    ok: requiredSeconds <= secondsUntilDeadline,
    requiredSeconds,
    secondsUntilDeadline,
    sunriseUtc,
    deadlineUtc,
  }
}

/**
 * Astronomical night window for "tonight" at observatory coordinates.
 * Window is astronomical dusk (zenith 108, sunset branch) to next astronomical dawn (zenith 108, sunrise branch).
 */
export function getTonightAstronomicalNightWindow(now = new Date()): {
  astronomicalDuskUtc: Date
  astronomicalDawnUtc: Date
  durationSeconds: number
} {
  const nowUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)

  // Before sunrise, "tonight" is the previous evening -> current morning.
  const baseUtcDate = new Date(nowUtcMidnight)
  if (now.getTime() < todaySunrise.getTime()) {
    baseUtcDate.setUTCDate(baseUtcDate.getUTCDate() - 1)
  }

  const nextUtcDate = new Date(baseUtcDate)
  nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1)

  const astronomicalDuskUtc = solarEventUtcForDate(baseUtcDate, 108, false)
  const astronomicalDawnUtc = solarEventUtcForDate(nextUtcDate, 108, true)
  const durationSeconds = Math.max(0, (astronomicalDawnUtc.getTime() - astronomicalDuskUtc.getTime()) / 1000)

  return { astronomicalDuskUtc, astronomicalDawnUtc, durationSeconds }
}

/** Imaging queue / placement window: **nautical dusk → nautical dawn** (observatory-local calendar anchor). */
export function getTonightSchedulingWindow(now = new Date(), site?: ObservatorySite): {
  nauticalDuskUtc: Date
  nauticalDawnUtc: Date
  /** Still computed for callers that need astronomical morning; queue deadline uses `nauticalDawnUtc`. */
  astronomicalDawnUtc: Date
} {
  const s = siteOrCurrent(site)
  const today = observatoryLocalCalendarAnchorUtc(now, s)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  const d = today.getUTCDate()
  const todaySunrise = solarEventUtcForDate(today, 90.833, true, s)
  let base = today
  if (now.getTime() < todaySunrise.getTime()) {
    base = new Date(Date.UTC(y, m - 1, d - 1))
  }
  const nextUtc = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1))
  const nauticalDuskUtc = solarEventUtcForDate(base, 102, false, s)
  const nauticalDawnUtc = solarEventUtcForDate(nextUtc, 102, true, s)
  const astronomicalDawnUtc = solarEventUtcForDate(nextUtc, 108, true, s)
  return { nauticalDuskUtc, nauticalDawnUtc, astronomicalDawnUtc }
}

/**
 * Civil night: evening civil dusk (−6°) through next morning civil dawn (−6°),
 * same “tonight” calendar anchor as `getTonightSchedulingWindow`.
 */
export function getCivilTwilightNightWindowUtc(now = new Date()): { civilDuskUtc: Date; civilDawnUtc: Date } {
  const nowUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  const baseUtcDate = new Date(nowUtcMidnight)
  if (now.getTime() < todaySunrise.getTime()) {
    baseUtcDate.setUTCDate(baseUtcDate.getUTCDate() - 1)
  }
  const nextUtcDate = new Date(baseUtcDate)
  nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1)
  return {
    civilDuskUtc: solarEventUtcForDate(baseUtcDate, 96, false),
    civilDawnUtc: solarEventUtcForDate(nextUtcDate, 96, true),
  }
}

/**
 * Evening solar / twilight instants on the same anchor as Remote `tonightSchedule`
 * (site-local strip start calendar day). Zeniths: sunset 90.833°, civil 96°, nautical 102°, astronomical 108°.
 */
export function getTonightScheduleEveningAstronomyUtc(
  now = new Date(),
  site?: ObservatorySite
): {
  sunsetUtc: Date
  civilDuskUtc: Date
  nauticalDuskUtc: Date
  astronomicalDarkUtc: Date
} {
  const s = siteOrCurrent(site)
  const startHour = s.scheduleStripStartHour
  const today = observatoryLocalCalendarAnchorUtc(now, s)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  const d = today.getUTCDate()
  // Sunrise gate: before local sunrise, "tonight" is still yesterday's strip.
  const todaySunrise = solarEventUtcForDate(today, 90.833, true, s)
  let base = today
  if (now.getTime() < todaySunrise.getTime()) {
    base = new Date(Date.UTC(y, m - 1, d - 1))
  }
  // Strip start hour is only used to stay consistent with nightKey; solar events use base civil day.
  void startHour
  return {
    sunsetUtc: solarEventUtcForDate(base, 90.833, false, s),
    civilDuskUtc: solarEventUtcForDate(base, 96, false, s),
    nauticalDuskUtc: solarEventUtcForDate(base, 102, false, s),
    astronomicalDarkUtc: solarEventUtcForDate(base, 108, false, s),
  }
}

/**
 * Next-morning solar / twilight on the day after the evening strip anchor.
 */
export function getTonightScheduleMorningAstronomyUtc(
  now = new Date(),
  site?: ObservatorySite
): {
  sunriseUtc: Date
  civilDawnUtc: Date
  nauticalDawnUtc: Date
  astronomicalDawnUtc: Date
} {
  const s = siteOrCurrent(site)
  const today = observatoryLocalCalendarAnchorUtc(now, s)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  const d = today.getUTCDate()
  const todaySunrise = solarEventUtcForDate(today, 90.833, true, s)
  let base = today
  if (now.getTime() < todaySunrise.getTime()) {
    base = new Date(Date.UTC(y, m - 1, d - 1))
  }
  const nextUtc = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1))
  return {
    sunriseUtc: solarEventUtcForDate(nextUtc, 90.833, true, s),
    civilDawnUtc: solarEventUtcForDate(nextUtc, 96, true, s),
    nauticalDawnUtc: solarEventUtcForDate(nextUtc, 102, true, s),
    astronomicalDawnUtc: solarEventUtcForDate(nextUtc, 108, true, s),
  }
}
