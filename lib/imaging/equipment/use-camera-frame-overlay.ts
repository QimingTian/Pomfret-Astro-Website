'use client'

import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  computeFovOverlayRotationDeg,
  raDecToScreenDelta,
  screenDeltaToRaDec,
  type FovOverlayStel,
} from '@/lib/fov-overlay'
import { computeFov, overlayRotationDeg, type ImagingEquipment } from '@/lib/imaging/equipment/equipment'
import { computeGridPanelLayoutDeltaPx, type GridLayoutParams } from '@/lib/mosaic/calculate-mosaic-panels'
import { layoutDeltaToScreenDelta } from '@/lib/mosaic/panel-coordinates'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'

const DEG2RAD = Math.PI / 180

export type CameraFrameProfile = {
  fovWRad: number
  fovHRad: number
  positionAngleDeg: number
}

type FrameOffsetRef = RefObject<{ x: number; y: number }>

export type CustomDragVisual = { panelId: number; x: number; y: number }

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
  /** Grid: sensor layout from mosaic center. Custom: see getCustomDragVisual. */
  useSensorLayout?: boolean
  gridLayout?: GridLayoutParams | null
  /** Grid: committed mosaic center for layout rotation (must be stable — never live inverse). */
  getGridScreenSkyCenter?: () => { raHours: number; decDeg: number } | null
  getViewCenterRaDec?: () => { raHours: number; decDeg: number } | null
  /**
   * Custom drag/pin visual in screen pixels, read from a ref each frame.
   * Avoids React state lag that desyncs the cursor from the frame.
   */
  getCustomDragVisual?: () => CustomDragVisual | null
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
  layoutRotDeg: number,
  mosaicCenterScreen: { x: number; y: number },
  useSensorLayout: boolean,
  gridLayout: GridLayoutParams | null | undefined,
  equipment: ImagingEquipment | null,
  viewportWidthPx: number,
  viewportHeightPx: number,
  vFovRad: number,
): { x: number; y: number } {
  if (!useSensorLayout) {
    return { x: mosaicCenterScreen.x + panel.screenDeltaXPx, y: mosaicCenterScreen.y + panel.screenDeltaYPx }
  }

  let layoutDeltaXPx = panel.layoutDeltaXPx
  let layoutDeltaYPx = panel.layoutDeltaYPx
  if ((layoutDeltaXPx == null || layoutDeltaYPx == null) && gridLayout && equipment) {
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
    layoutDeltaXPx = layout.layoutDeltaXPx
    layoutDeltaYPx = layout.layoutDeltaYPx
  }

  if (layoutDeltaXPx != null && layoutDeltaYPx != null) {
    const local = layoutDeltaToScreenDelta(layoutDeltaXPx, layoutDeltaYPx, layoutRotDeg)
    return {
      x: mosaicCenterScreen.x + local.x,
      y: mosaicCenterScreen.y + local.y,
    }
  }

  return mosaicCenterScreen
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
  el.style.setProperty('--panel-rot', `${rotationDeg}deg`)
  el.style.transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotationDeg}deg)`
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
  getGridScreenSkyCenter,
  getViewCenterRaDec,
  getCustomDragVisual,
}: Options): CameraFrameProfile | null {
  const profile = useCameraFrameProfile(enabled, equipment)
  const mosaicPanelsRef = useRef(mosaicPanels)
  mosaicPanelsRef.current = mosaicPanels

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
        const boresightRotDeg =
          computeFovOverlayRotationDeg(stel, profile.positionAngleDeg) ?? profile.positionAngleDeg
        // Grid: translate the whole mosaic in screen space only (stable, no live inverse).
        const mosaicCenterScreen = useSensorLayout ? drag : { x: 0, y: 0 }
        const layoutSkyCenter = useSensorLayout
          ? (getGridScreenSkyCenter?.() ?? getViewCenterRaDec?.() ?? null)
          : null
        const layoutRotDeg =
          layoutSkyCenter && useSensorLayout
            ? (computeFovOverlayRotationDeg(
                stel,
                profile.positionAngleDeg,
                layoutSkyCenter.raHours,
                layoutSkyCenter.decDeg,
              ) ?? boresightRotDeg)
            : boresightRotDeg
        const customDrag = !useSensorLayout ? (getCustomDragVisual?.() ?? null) : null

        if (isMosaic && mosaicOverlayRefs?.current) {
          // Always committed panels — never live-recomputed RAs while drawing (that caused Grid sway).
          const panels = mosaicPanelsRef.current ?? []
          for (const [id, el] of Array.from(mosaicOverlayRefs.current.entries())) {
            const panelIndex = panels.findIndex((p) => p.id === id)
            const panel = panelIndex >= 0 ? panels[panelIndex] : undefined
            if (!panel) continue

            let offset: { x: number; y: number }
            let panelRotDeg = boresightRotDeg

            if (!useSensorLayout) {
              if (customDrag && customDrag.panelId === panel.id) {
                // Drag/pin: ref pixels track the pointer 1:1.
                offset = { x: customDrag.x, y: customDrag.y }
                // Rotation from the dragged screen point (locked sky), not stale panel RA.
                const viewCenter = getViewCenterRaDec?.() ?? null
                const dragSky = screenDeltaToRaDec(
                  stel,
                  customDrag.x,
                  customDrag.y,
                  h,
                  fov,
                  viewCenter,
                )
                panelRotDeg =
                  (dragSky &&
                    computeFovOverlayRotationDeg(
                      stel,
                      profile.positionAngleDeg,
                      dragSky.raHours,
                      dragSky.decDeg,
                    )) ??
                  computeFovOverlayRotationDeg(
                    stel,
                    profile.positionAngleDeg,
                    panel.raHours,
                    panel.decDeg,
                  ) ??
                  boresightRotDeg
              } else {
                offset =
                  raDecToScreenDelta(stel, panel.raHours, panel.decDeg, h, fov) ?? {
                    x: panel.screenDeltaXPx,
                    y: panel.screenDeltaYPx,
                  }
                panelRotDeg =
                  computeFovOverlayRotationDeg(
                    stel,
                    profile.positionAngleDeg,
                    panel.raHours,
                    panel.decDeg,
                  ) ?? boresightRotDeg
              }
            } else {
              offset = panelScreenOffset(
                panel,
                panelIndex,
                layoutRotDeg,
                mosaicCenterScreen,
                useSensorLayout,
                gridLayout,
                equipment,
                w,
                h,
                fov,
              )
              panelRotDeg =
                computeFovOverlayRotationDeg(
                  stel,
                  profile.positionAngleDeg,
                  panel.raHours,
                  panel.decDeg,
                ) ?? layoutRotDeg
            }
            applyFrameTransform(el, profile, scale, offset, panelRotDeg)
          }
        } else {
          const el = overlayRef.current
          if (el) {
            // 1×1 Grid: locked sky = fixed image. Rotation from THIS screen offset's sky,
            // not stale/corrupt boresight — same pixels ⇒ same angle every time.
            const viewCenter = getViewCenterRaDec?.() ?? layoutSkyCenter
            const frameSky =
              Math.hypot(drag.x, drag.y) < 0.5
                ? viewCenter
                : screenDeltaToRaDec(stel, drag.x, drag.y, h, fov, viewCenter)
            const rotDeg =
              (frameSky &&
                computeFovOverlayRotationDeg(
                  stel,
                  profile.positionAngleDeg,
                  frameSky.raHours,
                  frameSky.decDeg,
                )) ??
              (layoutSkyCenter && useSensorLayout ? layoutRotDeg : boresightRotDeg)
            applyFrameTransform(el, profile, scale, mosaicCenterScreen, rotDeg)
          }
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
    useSensorLayout,
    gridLayout,
    equipment,
    getGridScreenSkyCenter,
    getViewCenterRaDec,
    getCustomDragVisual,
  ])

  return profile
}
