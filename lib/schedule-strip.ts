import { getTonightScheduleEveningAstronomyUtc, getTonightScheduleMorningAstronomyUtc } from '@/lib/sunrise-window'
import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

/** Matches Remote “tonight” strip: local 4pm → next day 8am, keyed by strip start calendar day. */
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

function sunriseUtcForLocalCalendarDay(now: Date): Date {
  const anchor = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const n = dayOfYearUTC(anchor)
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
  const zenithRad = degToRad(90.833)
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl))
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngleDeg = radToDeg(Math.acos(clamped))
  const solarNoonMin = 720 - 4 * OBS_LON_DEG - eqTime
  const eventMin = solarNoonMin - 4 * hourAngleDeg
  const midnightUtc = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  return new Date(midnightUtc + eventMin * 60000)
}

export function getTonightScheduleStrip(now = new Date()): TonightScheduleStrip {
  const todaySunrise = sunriseUtcForLocalCalendarDay(now)
  const start = new Date(now)
  start.setHours(16, 0, 0, 0)
  if (now.getTime() < todaySunrise.getTime()) {
    start.setDate(start.getDate() - 1)
  }
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setHours(8, 0, 0, 0)

  const y = start.getFullYear()
  const m = String(start.getMonth() + 1).padStart(2, '0')
  const d = String(start.getDate()).padStart(2, '0')
  const nightKey = `${y}-${m}-${d}`

  const { nauticalDuskUtc } = getTonightScheduleEveningAstronomyUtc(now)
  const { astronomicalDawnUtc } = getTonightScheduleMorningAstronomyUtc(now)
  const windowStartMs = start.getTime()
  const windowEndMs = end.getTime()
  const schedulingDeadlineMs = Math.min(windowEndMs, astronomicalDawnUtc.getTime())

  return {
    nightKey,
    windowStartMs,
    windowEndMs,
    schedulingDeadlineMs,
    nauticalDuskMs: nauticalDuskUtc.getTime(),
  }
}
