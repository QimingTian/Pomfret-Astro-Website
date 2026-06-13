function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * astrometry.net `orientation`: image +X (column) axis, degrees east of celestial north.
 * NINA rotator PositionAngle uses a different convention (typically ~180° from +X for DSLR JPEG).
 */
export function astrometryOrientationToPositionAngle(orientationDeg: number): number {
  const pa = 360 - (180 - orientationDeg + 360)
  return normalizeDeg(pa)
}

/**
 * Atlas camera-frame overlay: direction of the **displayed image top** (−Y pixel axis)
 * east of celestial north. Derived from astrometry +X orientation and parity.
 * JPEG/PNG plate solves usually have negative parity.
 */
export function astrometryCalibrationToImageTopPA(
  orientationDeg: number,
  parity: number | null | undefined,
): number {
  if (typeof parity === 'number' && parity < 0) {
    return normalizeDeg(orientationDeg + 90)
  }
  return normalizeDeg(orientationDeg - 90)
}
