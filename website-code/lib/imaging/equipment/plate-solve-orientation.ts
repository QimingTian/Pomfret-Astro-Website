function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export type AstrometryUploadKind = 'jpeg' | 'fits'

export function astrometryApiOrientationToImageTopPA(
  orientationDeg: number,
  uploadKind: AstrometryUploadKind = 'jpeg',
): number {
  if (uploadKind === 'jpeg') {
    return normalizeDeg(180 - orientationDeg)
  }
  return normalizeDeg(orientationDeg)
}

export function astrometryOrientationToPositionAngle(orientationDeg: number): number {
  return normalizeDeg(orientationDeg - 180)
}
