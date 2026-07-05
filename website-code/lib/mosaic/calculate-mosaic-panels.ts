import type { ImagingEquipment } from '@/lib/imaging/equipment/equipment'
import type { MosaicPanel } from './framing-rectangle'
import { defaultPositionAngleDeg } from './panel-coordinates'
import { shiftCoordinatesPixels } from './shift-coordinates'

export type CalculateMosaicInput = {
  centerRaHours: number
  centerDecDeg: number
  horizontalPanels: number
  verticalPanels: number
  horizontalOverlapPercent: number
  verticalOverlapPercent: number
  equipment: ImagingEquipment
  viewportWidthPx: number
  viewportHeightPx: number
  viewportHFovDeg: number
  viewportVFovDeg: number
  viewportRotationDeg: number
  previousRotationDeg?: number
}

export type CalculateMosaicResult = {
  panels: MosaicPanel[]
  isMosaic: boolean
}

const ARCSEC_PER_RADIAN = 206264.8062471

function arcsecPerPixel(eq: ImagingEquipment): number {
  return (eq.pixelSizeUm / eq.focalLengthMm) * (ARCSEC_PER_RADIAN / 1000)
}

export type GridLayoutParams = {
  horizontalPanels: number
  verticalPanels: number
  horizontalOverlapPercent: number
  verticalOverlapPercent: number
}

/** Sensor-aligned layout offset for one grid cell at the current viewport zoom. */
export function computeGridPanelLayoutDeltaPx(
  col: number,
  row: number,
  params: GridLayoutParams,
  equipment: ImagingEquipment,
  viewportWidthPx: number,
  viewportHeightPx: number,
  vFovRad: number,
): { layoutDeltaXPx: number; layoutDeltaYPx: number } {
  const hPanels = Math.max(1, Math.round(params.horizontalPanels))
  const vPanels = Math.max(1, Math.round(params.verticalPanels))
  const vFovDeg = (vFovRad * 180) / Math.PI
  const hFovDeg = vFovDeg * (viewportWidthPx / Math.max(1, viewportHeightPx))
  const imageArcsecWidth = (hFovDeg * 3600) / Math.max(1, viewportWidthPx)
  const conversion = arcsecPerPixel(equipment) / imageArcsecWidth
  const panelWidthPx = equipment.sensorWidthPx * conversion
  const panelHeightPx = equipment.sensorHeightPx * conversion
  const panelOverlapWidthPx = equipment.sensorWidthPx * params.horizontalOverlapPercent * conversion
  const panelOverlapHeightPx = equipment.sensorHeightPx * params.verticalOverlapPercent * conversion
  const stepX = panelWidthPx - panelOverlapWidthPx
  const stepY = panelHeightPx - panelOverlapHeightPx
  return {
    layoutDeltaXPx: (col - (hPanels - 1) / 2) * stepX,
    layoutDeltaYPx: (row - (vPanels - 1) / 2) * stepY,
  }
}

export function calculateMosaicPanels(input: CalculateMosaicInput): CalculateMosaicResult {
  const hPanels = Math.max(1, Math.round(input.horizontalPanels))
  const vPanels = Math.max(1, Math.round(input.verticalPanels))
  const isMosaic = hPanels > 1 || vPanels > 1

  const imageArcsecWidth = (input.viewportHFovDeg * 3600) / Math.max(1, input.viewportWidthPx)
  const imageArcsecHeight = (input.viewportVFovDeg * 3600) / Math.max(1, input.viewportHeightPx)
  const conversion = arcsecPerPixel(input.equipment) / imageArcsecWidth

  const panelWidthPx = input.equipment.sensorWidthPx * conversion
  const panelHeightPx = input.equipment.sensorHeightPx * conversion

  const previousRotation = input.previousRotationDeg ?? 0
  const rotationDeg = previousRotation + input.viewportRotationDeg

  if (!isMosaic) {
    const dsoPa = defaultPositionAngleDeg(null, previousRotation, input.viewportRotationDeg)
    return {
      isMosaic: false,
      panels: [
        {
          id: 1,
          raHours: input.centerRaHours,
          decDeg: input.centerDecDeg,
          positionAngleDeg: dsoPa,
          name: 'Panel 1',
          layoutDeltaXPx: 0,
          layoutDeltaYPx: 0,
          screenDeltaXPx: 0,
          screenDeltaYPx: 0,
        },
      ],
    }
  }

  const panelOverlapWidthPx = input.equipment.sensorWidthPx * input.horizontalOverlapPercent * conversion
  const panelOverlapHeightPx = input.equipment.sensorHeightPx * input.verticalOverlapPercent * conversion
  const stepX = panelWidthPx - panelOverlapWidthPx
  const stepY = panelHeightPx - panelOverlapHeightPx

  const panels: MosaicPanel[] = []
  let id = 1

  for (let j = 0; j < vPanels; j++) {
    for (let i = 0; i < hPanels; i++) {
      const layoutDeltaXPx = (i - (hPanels - 1) / 2) * stepX
      const layoutDeltaYPx = (j - (vPanels - 1) / 2) * stepY

      const panelCoords = shiftCoordinatesPixels(
        input.centerRaHours,
        input.centerDecDeg,
        layoutDeltaXPx,
        layoutDeltaYPx,
        rotationDeg,
        imageArcsecWidth,
        imageArcsecHeight,
      )

      const dsoPa = defaultPositionAngleDeg(null, previousRotation, input.viewportRotationDeg)

      panels.push({
        id: id++,
        raHours: panelCoords.raHours,
        decDeg: panelCoords.decDeg,
        positionAngleDeg: dsoPa,
        name: `Panel ${panels.length + 1}`,
        layoutDeltaXPx,
        layoutDeltaYPx,
        screenDeltaXPx: 0,
        screenDeltaYPx: 0,
      })
    }
  }

  return { isMosaic: true, panels }
}

export function cameraFovRadians(eq: ImagingEquipment): { fovWRad: number; fovHRad: number } {
  const chipWidthMm = (eq.sensorWidthPx * eq.pixelSizeUm) / 1000
  const chipHeightMm = (eq.sensorHeightPx * eq.pixelSizeUm) / 1000
  return {
    fovWRad: 2 * Math.atan(chipWidthMm / (2 * eq.focalLengthMm)),
    fovHRad: 2 * Math.atan(chipHeightMm / (2 * eq.focalLengthMm)),
  }
}
