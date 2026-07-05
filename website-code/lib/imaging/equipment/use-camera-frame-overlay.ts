'use client'

import { useEffect, useMemo, type RefObject } from 'react'
import { computeFovOverlayRotationDeg, type FovOverlayStel } from '@/lib/fov-overlay'
import { computeFov, overlayRotationDeg, type ImagingEquipment } from '@/lib/imaging/equipment/equipment'
import { computeGridPanelLayoutDeltaPx, type GridLayoutParams } from '@/lib/mosaic/calculate-mosaic-panels'
import { layoutDeltaToScreenDelta, panelScreenOffsetToRaDec, viewportArcsecPerPixel } from '@/lib/mosaic/panel-coordinates'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'

const DEG2RAD = Math.PI / 180

export type CameraFrameProfile = {
  fovWRad: number
  fovHRad: number
  positionAngleDeg: number
}

type FrameOffsetRef = RefObject<{ x: number; y: number }>

type Options = {
  enabled: boolean
  equipment: ImagingEquipment | null
  stelReady: boolean
  getStel: () => FovOverlayStel | null
  iframeRef: RefObject<HTMLIFrameElement | null>
  overlayRef: RefObject<HTMLDivElement | null>
  frameOffsetRef?: FrameOffsetRef
  mosaicOverlayRefs?: RefObject<Map<number, HTMLDivElement>>
  mosaicPanels?: MosaicPanel[]
  isMosaic?: boolean
  /** Grid panels use sensor-aligned layout deltas; custom panels use screen deltas directly. */
  useSensorLayout?: boolean
  gridLayout?: GridLayoutParams | null
  /** Boresight / view center for custom panel sky position (parallactic rotation). */
  getViewCenterRaDec?: () => { raHours: number; decDeg: number } | null
}

export function useCameraFrameProfile(
  enabled: boolean,
  equipment: ImagingEquipment | null,
): CameraFrameProfile | null {
  return useMemo((): CameraFrameProfile | null => {
    if (!enabled || !equipment) return null
    const fov = computeFov(equipment)
    return {
      fovWRad: fov.fovWidthDeg * DEG2RAD,
      fovHRad: fov.fovHeightDeg * DEG2RAD,
      positionAngleDeg: overlayRotationDeg(equipment),
    }
  }, [enabled, equipment, equipment?.fieldRotationDeg])
}

function panelScreenOffset(
  panel: MosaicPanel,
  panelIndex: number,
  rotDeg: number,
  useSensorLayout: boolean,
  drag: { x: number; y: number },
  gridLayout: GridLayoutParams | null | undefined,
  equipment: ImagingEquipment | null,
  viewportWidthPx: number,
  viewportHeightPx: number,
  vFovRad: number,
): { x: number; y: number } {
  if (useSensorLayout && gridLayout && equipment) {
    const hPanels = Math.max(1, Math.round(gridLayout.horizontalPanels))
    const col = panelIndex % hPanels
    const row = Math.floor(panelIndex / hPanels)
    const layout = computeGridPanelLayoutDeltaPx(
      col,
      row,
      gridLayout,
      equipment,
      viewportWidthPx,
      viewportHeightPx,
      vFovRad,
    )
    const screen = layoutDeltaToScreenDelta(layout.layoutDeltaXPx, layout.layoutDeltaYPx, rotDeg)
    return { x: screen.x + drag.x, y: screen.y + drag.y }
  }
  if (useSensorLayout && panel.layoutDeltaXPx != null && panel.layoutDeltaYPx != null) {
    const screen = layoutDeltaToScreenDelta(panel.layoutDeltaXPx, panel.layoutDeltaYPx, rotDeg)
    return { x: screen.x + drag.x, y: screen.y + drag.y }
  }
  return {
    x: panel.screenDeltaXPx + drag.x,
    y: panel.screenDeltaYPx + drag.y,
  }
}

function applyFrameTransform(
  el: HTMLElement,
  profile: CameraFrameProfile,
  scale: number,
  offset: { x: number; y: number },
  rotationDeg: number,
) {
  el.style.width = `${profile.fovWRad * scale}px`
  el.style.height = `${profile.fovHRad * scale}px`
  el.style.transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotationDeg}deg)`
}

function panelSkyPosition(
  panel: MosaicPanel,
  drag: { x: number; y: number },
  boresightRotDeg: number,
  getViewCenterRaDec: (() => { raHours: number; decDeg: number } | null) | undefined,
  viewportWidthPx: number,
  viewportHeightPx: number,
  hFovDeg: number,
  vFovDeg: number,
): { raHours: number; decDeg: number } | null {
  const center = getViewCenterRaDec?.()
  if (!center) return { raHours: panel.raHours, decDeg: panel.decDeg }
  const arcsec = viewportArcsecPerPixel(viewportWidthPx, viewportHeightPx, hFovDeg, vFovDeg)
  return panelScreenOffsetToRaDec(
    center.raHours,
    center.decDeg,
    panel.screenDeltaXPx + drag.x,
    panel.screenDeltaYPx + drag.y,
    boresightRotDeg,
    arcsec.x,
    arcsec.y,
  )
}

/** Borean Atlas camera-frame RAF loop — drives overlay size + parallactic rotation. */
export function useCameraFrameOverlay({
  enabled,
  equipment,
  stelReady,
  getStel,
  iframeRef,
  overlayRef,
  frameOffsetRef,
  mosaicOverlayRefs,
  mosaicPanels,
  isMosaic = false,
  useSensorLayout = true,
  gridLayout = null,
  getViewCenterRaDec,
}: Options): CameraFrameProfile | null {
  const profile = useCameraFrameProfile(enabled, equipment)

  useEffect(() => {
    if (!profile || !stelReady) return
    let rafId = 0
    const tick = () => {
      const iframe = iframeRef.current
      const stel = getStel()
      const fov = stel?.core?.fov
      const h = iframe?.clientHeight ?? 520
      const w = iframe?.clientWidth ?? 800
      if (typeof fov === 'number' && fov > 0) {
        const scale = h / fov
        const drag = frameOffsetRef?.current ?? { x: 0, y: 0 }
        const vFovDeg = (fov * 180) / Math.PI
        const hFovDeg = vFovDeg * (w / h)
        const boresightRotDeg =
          computeFovOverlayRotationDeg(stel, profile.positionAngleDeg) ?? profile.positionAngleDeg
        if (isMosaic && mosaicOverlayRefs?.current && mosaicPanels?.length) {
          for (const [id, el] of Array.from(mosaicOverlayRefs.current.entries())) {
            const panelIndex = mosaicPanels.findIndex((p) => p.id === id)
            const panel = panelIndex >= 0 ? mosaicPanels[panelIndex] : undefined
            if (!panel) continue
            const offset = panelScreenOffset(
              panel,
              panelIndex,
              boresightRotDeg,
              useSensorLayout,
              drag,
              gridLayout,
              equipment,
              w,
              h,
              fov,
            )
            // Grid: rigid mosaic — one field rotation (reference / center panel); panel
            // positions already account for PA via shiftCoordinatesPixels in calculateMosaicPanels.
            // Custom: parallactic rotation at each panel's own sky position.
            let panelRotDeg = boresightRotDeg
            if (!useSensorLayout) {
              const sky = panelSkyPosition(
                panel,
                drag,
                boresightRotDeg,
                getViewCenterRaDec,
                w,
                h,
                hFovDeg,
                vFovDeg,
              )
              panelRotDeg =
                (sky &&
                  computeFovOverlayRotationDeg(
                    stel,
                    profile.positionAngleDeg,
                    sky.raHours,
                    sky.decDeg,
                  )) ??
                boresightRotDeg
            }
            applyFrameTransform(el, profile, scale, offset, panelRotDeg)
          }
        } else {
          const el = overlayRef.current
          if (el) applyFrameTransform(el, profile, scale, drag, boresightRotDeg)
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    profile,
    stelReady,
    getStel,
    iframeRef,
    overlayRef,
    frameOffsetRef,
    mosaicOverlayRefs,
    isMosaic,
    mosaicPanels,
    useSensorLayout,
    gridLayout,
    equipment,
    getViewCenterRaDec,
  ])

  return profile
}
