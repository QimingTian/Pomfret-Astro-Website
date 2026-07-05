import { astrometryApiOrientationToImageTopPA } from './plate-solve-orientation'

/** Arcseconds subtended by one radian (3600 * 180 / PI). NINA uses the same constant. */
const ARCSEC_PER_RADIAN = 206264.8062471

export type ImagingEquipment = {
  label: string
  focalLengthMm: number
  pixelSizeUm: number
  sensorWidthPx: number
  sensorHeightPx: number
  /** Image top edge on sky (° E of N) — drives Plan/Atlas camera frame rotation. */
  fieldRotationDeg: number
  /** NINA rotator PA from plate-solve; optional metadata only. */
  positionAngleDeg?: number
  rawImageOrientationDeg?: number
  imageParity?: number | null
}

export type EquipmentFov = {
  arcsecPerPixel: number
  fovWidthDeg: number
  fovHeightDeg: number
}

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Resolve frame rotation from stored rig (migrates legacy position-angle-only saves). */
export function resolveFieldRotationDeg(eq: Partial<ImagingEquipment>): number | undefined {
  if (typeof eq.fieldRotationDeg === 'number' && Number.isFinite(eq.fieldRotationDeg)) {
    return normalizeDeg(eq.fieldRotationDeg)
  }
  if (typeof eq.rawImageOrientationDeg === 'number' && Number.isFinite(eq.rawImageOrientationDeg)) {
    return astrometryApiOrientationToImageTopPA(eq.rawImageOrientationDeg, 'jpeg')
  }
  if (typeof eq.positionAngleDeg === 'number' && Number.isFinite(eq.positionAngleDeg)) {
    return normalizeDeg(eq.positionAngleDeg - 90)
  }
  return undefined
}

export function mergeEquipmentManualSave(
  prev: ImagingEquipment | null,
  next: ImagingEquipment,
): ImagingEquipment {
  const rotChanged =
    prev == null || normalizeDeg(prev.fieldRotationDeg) !== normalizeDeg(next.fieldRotationDeg)
  if (rotChanged) {
    return {
      ...next,
      rawImageOrientationDeg: undefined,
      imageParity: undefined,
    }
  }
  return {
    ...next,
    rawImageOrientationDeg: prev.rawImageOrientationDeg,
    imageParity: prev.imageParity,
    positionAngleDeg: prev.positionAngleDeg,
  }
}

export function isEquipmentValid(eq: Partial<ImagingEquipment> | null | undefined): eq is ImagingEquipment {
  if (!eq) return false
  const fieldRotationDeg = resolveFieldRotationDeg(eq)
  if (fieldRotationDeg == null) return false
  return (
    isPositive(eq.focalLengthMm) &&
    isPositive(eq.pixelSizeUm) &&
    isPositive(eq.sensorWidthPx) &&
    isPositive(eq.sensorHeightPx)
  )
}

export function overlayRotationDeg(eq: ImagingEquipment): number {
  return normalizeDeg(eq.fieldRotationDeg)
}

export function computeFov(eq: ImagingEquipment): EquipmentFov {
  const arcsecPerPixel = (eq.pixelSizeUm / eq.focalLengthMm) * (ARCSEC_PER_RADIAN / 1000)
  return {
    arcsecPerPixel,
    fovWidthDeg: (arcsecPerPixel * eq.sensorWidthPx) / 3600,
    fovHeightDeg: (arcsecPerPixel * eq.sensorHeightPx) / 3600,
  }
}

export function normalizeEquipment(parsed: Partial<ImagingEquipment>): ImagingEquipment | null {
  if (!isEquipmentValid(parsed)) return null
  const fieldRotationDeg = resolveFieldRotationDeg(parsed)!
  return {
    label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : 'Imaging rig',
    focalLengthMm: parsed.focalLengthMm,
    pixelSizeUm: parsed.pixelSizeUm,
    sensorWidthPx: parsed.sensorWidthPx,
    sensorHeightPx: parsed.sensorHeightPx,
    fieldRotationDeg,
    positionAngleDeg:
      typeof parsed.positionAngleDeg === 'number' && Number.isFinite(parsed.positionAngleDeg)
        ? normalizeDeg(parsed.positionAngleDeg)
        : undefined,
    rawImageOrientationDeg:
      typeof parsed.rawImageOrientationDeg === 'number' && Number.isFinite(parsed.rawImageOrientationDeg)
        ? parsed.rawImageOrientationDeg
        : undefined,
    imageParity: typeof parsed.imageParity === 'number' ? parsed.imageParity : undefined,
  }
}

export type EquipmentInput = {
  label: string
  focalLengthMm: string
  pixelSizeUm: string
  sensorWidthPx: string
  sensorHeightPx: string
  fieldRotationDeg: string
}

export function validateEquipmentInput(
  input: EquipmentInput,
): { ok: true; equipment: ImagingEquipment } | { ok: false; error: string } {
  const focalLengthMm = Number(input.focalLengthMm)
  const pixelSizeUm = Number(input.pixelSizeUm)
  const sensorWidthPx = Number(input.sensorWidthPx)
  const sensorHeightPx = Number(input.sensorHeightPx)
  const fieldRotationDeg = input.fieldRotationDeg.trim() === '' ? 0 : Number(input.fieldRotationDeg)

  if (!isPositive(focalLengthMm)) return { ok: false, error: 'Focal length must be a positive number (mm).' }
  if (!isPositive(pixelSizeUm)) return { ok: false, error: 'Pixel size must be a positive number (µm).' }
  if (!isPositive(sensorWidthPx)) return { ok: false, error: 'Sensor width must be a positive number (px).' }
  if (!isPositive(sensorHeightPx)) return { ok: false, error: 'Sensor height must be a positive number (px).' }
  if (!Number.isFinite(fieldRotationDeg)) {
    return { ok: false, error: 'Field rotation must be a number (degrees).' }
  }

  return {
    ok: true,
    equipment: {
      label: input.label.trim() || 'Imaging rig',
      focalLengthMm,
      pixelSizeUm,
      sensorWidthPx,
      sensorHeightPx,
      fieldRotationDeg: normalizeDeg(fieldRotationDeg),
    },
  }
}
