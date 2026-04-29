import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

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

function solarEventUtcForDate(date: Date, zenithDeg: number, isSunrise: boolean): Date {
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

function sunriseUtcForDate(date: Date): Date {
  return solarEventUtcForDate(date, 90.833, true)
}

function sunsetUtcForDate(date: Date): Date {
  return solarEventUtcForDate(date, 90.833, false)
}

function nauticalDawnUtcForDate(date: Date): Date {
  return solarEventUtcForDate(date, 102, true)
}

function nauticalDuskUtcForDate(date: Date): Date {
  return solarEventUtcForDate(date, 102, false)
}

/** Nautical dawn/dusk (UTC) and daytime-closed band (nautical dawn … nautical dusk) for UTC day of `now`. */
export function getDaytimeClosedWindowDetail(now = new Date()): {
  within: boolean
  nauticalDawnUtc: string
  nauticalDuskUtc: string
  sunriseUtc: string
  sunsetUtc: string
  closedStartUtc: string
  closedEndUtc: string
} {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const nauticalDawn = nauticalDawnUtcForDate(today)
  const nauticalDusk = nauticalDuskUtcForDate(today)
  const sunrise = sunriseUtcForDate(today)
  const sunset = sunsetUtcForDate(today)
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

/** Scheduling window helper for session ordering logic. */
export function getTonightSchedulingWindow(now = new Date()): {
  nauticalDuskUtc: Date
  astronomicalDawnUtc: Date
} {
  const nowUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  const baseUtcDate = new Date(nowUtcMidnight)
  if (now.getTime() < todaySunrise.getTime()) {
    baseUtcDate.setUTCDate(baseUtcDate.getUTCDate() - 1)
  }
  const nextUtcDate = new Date(baseUtcDate)
  nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1)

  const nauticalDuskUtc = solarEventUtcForDate(baseUtcDate, 102, false)
  const astronomicalDawnUtc = solarEventUtcForDate(nextUtcDate, 108, true)
  return { nauticalDuskUtc, astronomicalDawnUtc }
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
