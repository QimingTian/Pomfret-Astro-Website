export const OBS_LAT_DEG = 41 + 53 / 60 + 10 / 3600
export const OBS_LON_DEG = -(71 + 57 / 60 + 54 / 3600) // West is negative

export const MIN_ALTITUDE_DEG = 30
export const TONIGHT_OBSERVABLE_MIN_COVERAGE_MS = 30 * 60 * 1000

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function normalizeDegrees(x: number): number {
  let v = x % 360
  if (v < 0) v += 360
  return v
}

function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5
}

function gmstDegrees(date: Date): number {
  const jd = julianDay(date)
  const t = (jd - 2451545.0) / 36525
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000
  return normalizeDegrees(gmst)
}

export function currentAltitudeDeg(raHours: number, decDeg: number, now = new Date()): number {
  const raDeg = raHours * 15
  const lstDeg = normalizeDegrees(gmstDegrees(now) + OBS_LON_DEG)
  const hourAngleDeg = normalizeDegrees(lstDeg - raDeg)

  const latRad = degToRad(OBS_LAT_DEG)
  const decRad = degToRad(decDeg)
  const haRad = degToRad(hourAngleDeg > 180 ? hourAngleDeg - 360 : hourAngleDeg)

  const sinAlt =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad)

  const clamped = Math.max(-1, Math.min(1, sinAlt))
  return radToDeg(Math.asin(clamped))
}

export function isAltitudeAllowed(raHours: number, decDeg: number): {
  ok: boolean
  altitudeDeg: number
  minAltitudeDeg: number
} {
  const altitudeDeg = currentAltitudeDeg(raHours, decDeg)
  return {
    ok: altitudeDeg >= MIN_ALTITUDE_DEG,
    altitudeDeg,
    minAltitudeDeg: MIN_ALTITUDE_DEG,
  }
}

/**
 * Approximate allowed-altitude coverage in [startMs, endMs) using fixed time buckets.
 * A bucket counts as allowed when altitude at its midpoint is >= MIN_ALTITUDE_DEG.
 */
export function altitudeCoverageMsAtMinAltitude(
  raHours: number,
  decDeg: number,
  startMs: number,
  endMs: number,
  minAltitudeDeg: number,
  stepMs = 5 * 60 * 1000
): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  const step = Math.max(60_000, Math.floor(stepMs))
  let covered = 0
  for (let t = startMs; t < endMs; t += step) {
    const segEnd = Math.min(t + step, endMs)
    const mid = t + (segEnd - t) / 2
    const altitude = currentAltitudeDeg(raHours, decDeg, new Date(mid))
    if (altitude >= minAltitudeDeg) {
      covered += segEnd - t
    }
  }
  return covered
}

export function altitudeAllowedCoverageMs(
  raHours: number,
  decDeg: number,
  startMs: number,
  endMs: number,
  stepMs = 5 * 60 * 1000
): number {
  return altitudeCoverageMsAtMinAltitude(
    raHours,
    decDeg,
    startMs,
    endMs,
    MIN_ALTITUDE_DEG,
    stepMs
  )
}

/** First time in [startMs, endMs] where altitude is >= MIN_ALTITUDE_DEG. */
export function firstAltitudeAllowedTimeMs(
  raHours: number,
  decDeg: number,
  startMs: number,
  endMs: number,
  stepMs = 5 * 60 * 1000
): number | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null
  const step = Math.max(60_000, Math.floor(stepMs))
  for (let t = startMs; t <= endMs; t += step) {
    if (currentAltitudeDeg(raHours, decDeg, new Date(t)) >= MIN_ALTITUDE_DEG) return t
  }
  return null
}
