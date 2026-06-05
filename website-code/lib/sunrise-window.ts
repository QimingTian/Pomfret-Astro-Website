import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

/** Civil calendar + solar gates for Pomfret; must match Remote “tonight schedule” expectations. */
export const OBSERVATORY_TIME_ZONE = 'America/New_York'

/**
 * UTC `Date` at 00:00:00 for the observatory's **local** civil calendar day containing `now`
 * (same Y-M-D as America/New_York wall date). Used as `solarEventUtcForDate` anchor so nautical
 * dawn/dusk match local evening; avoids treating UTC-midnight as “new day” while US evening
 * is still before local nautical dusk (which incorrectly cleared daytime-closed → Ready).
 */
export function observatoryLocalCalendarAnchorUtc(now: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: OBSERVATORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const s = formatter.format(now)
  const [y, m, d] = s.split('-').map((part) => Number(part))
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

/** Nautical dawn/dusk (UTC) and daytime-closed band (nautical dawn … nautical dusk) for observatory local day of `now`. */
export function getDaytimeClosedWindowDetail(now = new Date()): {
  within: boolean
  nauticalDawnUtc: string
  nauticalDuskUtc: string
  sunriseUtc: string
  sunsetUtc: string
  closedStartUtc: string
  closedEndUtc: string
} {
  const today = observatoryLocalCalendarAnchorUtc(now)
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

/** Imaging queue / placement window: **nautical dusk → nautical dawn** (same calendar anchor as elsewhere). */
export function getTonightSchedulingWindow(now = new Date()): {
  nauticalDuskUtc: Date
  nauticalDawnUtc: Date
  /** Still computed for callers that need astronomical morning; queue deadline uses `nauticalDawnUtc`. */
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
  const nauticalDawnUtc = solarEventUtcForDate(nextUtcDate, 102, true)
  const astronomicalDawnUtc = solarEventUtcForDate(nextUtcDate, 108, true)
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
 * Evening solar / twilight instants on the same anchor as Remote `tonightSchedule`:
 * local 16:00 window start, `todaySunrise` gate using `Date.UTC(now.getFullYear(), …)` (browser local calendar),
 * then `baseUtc` from that window’s start date. Zeniths: official sunset 90.833°, civil 96°, nautical 102°, astronomical 108°.
 */
export function getTonightScheduleEveningAstronomyUtc(now = new Date()): {
  sunsetUtc: Date
  civilDuskUtc: Date
  nauticalDuskUtc: Date
  astronomicalDarkUtc: Date
} {
  const start = new Date(now)
  start.setHours(16, 0, 0, 0)
  const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  if (now.getTime() < todaySunrise.getTime()) {
    start.setDate(start.getDate() - 1)
  }
  const baseUtc = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
  return {
    sunsetUtc: solarEventUtcForDate(baseUtc, 90.833, false),
    civilDuskUtc: solarEventUtcForDate(baseUtc, 96, false),
    nauticalDuskUtc: solarEventUtcForDate(baseUtc, 102, false),
    astronomicalDarkUtc: solarEventUtcForDate(baseUtc, 108, false),
  }
}

/**
 * Next-morning solar / twilight instants on the same anchor as `getTonightScheduleEveningAstronomyUtc`
 * (Remote `tonightSchedule` window: local 16:00 start → +24h → 08:00 end). `nextUtc` is the UTC midnight
 * of the schedule end's local calendar day. Zeniths: official sunrise 90.833°, civil 96°, nautical 102°,
 * astronomical 108°.
 */
export function getTonightScheduleMorningAstronomyUtc(now = new Date()): {
  sunriseUtc: Date
  civilDawnUtc: Date
  nauticalDawnUtc: Date
  astronomicalDawnUtc: Date
} {
  const start = new Date(now)
  start.setHours(16, 0, 0, 0)
  const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  if (now.getTime() < todaySunrise.getTime()) {
    start.setDate(start.getDate() - 1)
  }
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setHours(8, 0, 0, 0)
  const nextUtc = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
  return {
    sunriseUtc: solarEventUtcForDate(nextUtc, 90.833, true),
    civilDawnUtc: solarEventUtcForDate(nextUtc, 96, true),
    nauticalDawnUtc: solarEventUtcForDate(nextUtc, 102, true),
    astronomicalDawnUtc: solarEventUtcForDate(nextUtc, 108, true),
  }
}
