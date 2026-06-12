import { DEFAULT_OBS_LAT, DEFAULT_OBS_LON } from '@/lib/content/observatory-coords'

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
  const latRad = degToRad(DEFAULT_OBS_LAT)
  const zenithRad = degToRad(zenithDeg)
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl))
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngleDeg = radToDeg(Math.acos(clamped))
  const solarNoonMin = 720 - 4 * DEFAULT_OBS_LON - eqTime
  const eventMin = isSunrise ? solarNoonMin - 4 * hourAngleDeg : solarNoonMin + 4 * hourAngleDeg
  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return new Date(midnightUtc + eventMin * 60000)
}

export function getTonightSchedulingWindow(now = new Date()): {
  nauticalDuskUtc: Date
  nauticalDawnUtc: Date
} {
  const nowUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  const baseUtcDate = new Date(nowUtcMidnight)
  if (now.getTime() < todaySunrise.getTime()) {
    baseUtcDate.setUTCDate(baseUtcDate.getUTCDate() - 1)
  }
  const nextUtcDate = new Date(baseUtcDate)
  nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1)
  return {
    nauticalDuskUtc: solarEventUtcForDate(baseUtcDate, 102, false),
    nauticalDawnUtc: solarEventUtcForDate(nextUtcDate, 102, true),
  }
}
