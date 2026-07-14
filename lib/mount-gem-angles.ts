/** GEM hour-angle / declination helpers for the Remote Telescope Status 3D view. */

import { OBS_LON_DEG } from '@/lib/target-altitude'

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeSigned180(deg: number): number {
  let n = deg
  while (n <= -180) n += 360
  while (n > 180) n -= 360
  return n
}

export function normalize360(deg: number): number {
  let n = deg
  while (n < 0) n += 360
  while (n >= 360) n -= 360
  return n
}

/**
 * Local sidereal time in hours [0, 24), matching `lib/target-altitude` GMST convention.
 * NINA often omits `siderealTimeHours`; compute from UTC + site longitude (east-positive).
 */
export function localSiderealTimeHours(date: Date, longitudeDeg: number = OBS_LON_DEG): number {
  const jd = date.getTime() / 86400000 + 2440587.5
  const t = (jd - 2451545.0) / 36525
  let gmstDeg =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000
  gmstDeg = ((gmstDeg % 360) + 360) % 360
  let lstHours = (gmstDeg + longitudeDeg) / 15
  lstHours = ((lstHours % 24) + 24) % 24
  return lstHours
}

/**
 * Local hour angle in degrees, [-180, 180].
 * HA = LST − RA (both in hours), ×15. Positive HA = west of meridian.
 */
export function hourAngleDeg(raHours: number, siderealTimeHours: number): number {
  return normalizeSigned180((siderealTimeHours - raHours) * 15)
}

export function isPierWest(sideOfPier: string | null | undefined, haDeg: number): boolean {
  const sop = (sideOfPier ?? '').toLowerCase()
  if (sop === 'pierwest') return true
  if (sop === 'piereast') return false
  // Unknown: classic GEM heuristic — west when past meridian west.
  return Math.abs(haDeg) >= 90 ? haDeg > 0 : false
}

/**
 * Convert sky HA/Dec into Paramount ME spin deltas for the Blender / glTF model.
 *
 * Rest pose: ME_RA_SPIN / ME_DEC_SPIN identity ⇒ optics at NCP (Dec = +90°).
 * Both spins are authored as Blender local-Z (disc face-normal through disc center).
 *
 * Verified in Blender against alt/az for NGC7000 / Vega / Arcturus at Pomfret:
 *   pier east (A):  RA_Z = HA − 90°,  DEC_Z = Dec − 90°
 *   pier west (B):  RA_Z = HA + 90°,  DEC_Z = 90° − Dec
 * (Old mountHa / 90−mountDec was ~60–80° off on this model.)
 *
 * At the pole Dec tip is 0 and RA is free — snap RA to 0 so rest stays identity.
 *
 * Apply returned deltas about the glTF image of Blender +Z (Three local +Y after
 * export + root yaw 180°). Using −Y inverts pier-east/west while sky aim can still
 * look plausible near the meridian.
 */
export function gemSpinDeltasDeg(opts: {
  raHours: number
  decDeg: number
  siderealTimeHours: number
  sideOfPier?: string | null
}): { raDeltaDeg: number; decDeltaDeg: number; haDeg: number; pierWest: boolean } {
  const haDeg = hourAngleDeg(opts.raHours, opts.siderealTimeHours)
  const pierWest = isPierWest(opts.sideOfPier, haDeg)
  let raDeltaDeg = pierWest ? haDeg + 90 : haDeg - 90
  let decDeltaDeg = pierWest ? 90 - opts.decDeg : opts.decDeg - 90
  if (Math.abs(decDeltaDeg) < 1e-9) {
    raDeltaDeg = 0
  }
  return {
    haDeg,
    pierWest,
    raDeltaDeg,
    decDeltaDeg,
  }
}
