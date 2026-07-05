import type { ImagingEquipment } from '@/lib/imaging/equipment/equipment'
import { shiftCoordinatesPixels } from './shift-coordinates'

const DEG2RAD = Math.PI / 180

export function viewportArcsecPerPixel(
  viewportWidthPx: number,
  viewportHeightPx: number,
  hFovDeg: number,
  vFovDeg: number,
): { x: number; y: number } {
  return {
    x: (hFovDeg * 3600) / Math.max(1, viewportWidthPx),
    y: (vFovDeg * 3600) / Math.max(1, viewportHeightPx),
  }
}

/** Rotate a screen-space pixel offset into sensor/image coordinates. */
export function screenDeltaToLayoutDelta(
  screenDeltaXPx: number,
  screenDeltaYPx: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rad = -rotationDeg * DEG2RAD
  return {
    x: screenDeltaXPx * Math.cos(rad) - screenDeltaYPx * Math.sin(rad),
    y: screenDeltaXPx * Math.sin(rad) + screenDeltaYPx * Math.cos(rad),
  }
}

/** Rotate sensor-aligned layout offset into screen coordinates. */
export function layoutDeltaToScreenDelta(
  layoutDeltaXPx: number,
  layoutDeltaYPx: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rad = rotationDeg * DEG2RAD
  return {
    x: layoutDeltaXPx * Math.cos(rad) - layoutDeltaYPx * Math.sin(rad),
    y: layoutDeltaXPx * Math.sin(rad) + layoutDeltaYPx * Math.cos(rad),
  }
}

export function panelScreenOffsetToRaDec(
  centerRaHours: number,
  centerDecDeg: number,
  screenDeltaXPx: number,
  screenDeltaYPx: number,
  rotationDeg: number,
  arcsecPerPixelX: number,
  arcsecPerPixelY: number,
): { raHours: number; decDeg: number } {
  const layout = screenDeltaToLayoutDelta(screenDeltaXPx, screenDeltaYPx, rotationDeg)
  return shiftCoordinatesPixels(
    centerRaHours,
    centerDecDeg,
    layout.x,
    layout.y,
    rotationDeg,
    arcsecPerPixelX,
    arcsecPerPixelY,
  )
}

export function defaultPositionAngleDeg(
  equipment: ImagingEquipment | null,
  previousRotationDeg = 0,
  viewportRotationDeg = 0,
): number {
  const dsoRotation = previousRotationDeg + viewportRotationDeg
  return 360 - ((dsoRotation % 360) + 360) % 360
}
