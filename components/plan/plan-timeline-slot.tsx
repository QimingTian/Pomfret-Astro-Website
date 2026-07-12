'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import type { PlanMode } from './plan-mode-switch'
import { PlanRibbon, type RibbonAstronomyMarker } from './plan-ribbon'
import { PlanFramingToolbar } from './plan-framing-toolbar'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'

type Props = {
  planMode: PlanMode
  barRef: React.RefObject<HTMLDivElement>
  ribbonStartSec: number
  ribbonEndSec: number
  ribbonHourStartsSec: number[]
  weatherColorsKnown: boolean
  readySet: Set<number>
  markers: RibbonAstronomyMarker[]
  hoverFrac: number | null
  onHoverFrac: (frac: number | null) => void
  onRibbonClick: (ev: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void
  onReturnToNow: () => void
  stelReady: boolean
  hasEquipment: boolean
  customMosaic: boolean
  isMosaic: boolean
  horizontalPanels: number
  verticalPanels: number
  horizontalOverlapPercent: number
  verticalOverlapPercent: number
  panelCount: number
  onCustomMosaic: (v: boolean) => void
  onHorizontalPanels: (n: number) => void
  onVerticalPanels: (n: number) => void
  onHorizontalOverlapPercent: (v: number) => void
  onVerticalOverlapPercent: (v: number) => void
  onAddPanel: () => void
  customPanels: MosaicPanel[]
  deletePanelId: number
  onDeletePanelIdChange: (id: number) => void
  selectedPanelCoords: { raHours: number; decDeg: number } | null
  onSelectedPanelCoords: (raHours: number, decDeg: number) => void
  onDeletePanel: () => void
}

const DURATION = 0.38

export function PlanTimelineSlot({
  planMode,
  barRef,
  ribbonStartSec,
  ribbonEndSec,
  ribbonHourStartsSec,
  weatherColorsKnown,
  readySet,
  markers,
  hoverFrac,
  onHoverFrac,
  onRibbonClick,
  onReturnToNow,
  stelReady,
  hasEquipment,
  customMosaic,
  isMosaic,
  horizontalPanels,
  verticalPanels,
  horizontalOverlapPercent,
  verticalOverlapPercent,
  panelCount,
  onCustomMosaic,
  onHorizontalPanels,
  onVerticalPanels,
  onHorizontalOverlapPercent,
  onVerticalOverlapPercent,
  onAddPanel,
  customPanels,
  deletePanelId,
  onDeletePanelIdChange,
  selectedPanelCoords,
  onSelectedPanelCoords,
  onDeletePanel,
}: Props) {
  const slotRef = useRef<HTMLDivElement>(null)
  const ribbonRef = useRef<HTMLDivElement>(null)
  const framingRef = useRef<HTMLDivElement>(null)
  const prevModeRef = useRef<PlanMode | null>(null)

  useEffect(() => {
    const slot = slotRef.current
    const ribbon = ribbonRef.current
    const framing = framingRef.current
    if (!slot || !ribbon || !framing) return

    const toFraming = planMode === 'framing'
    const showEl = toFraming ? framing : ribbon
    const hideEl = toFraming ? ribbon : framing
    const firstPaint = prevModeRef.current == null
    prevModeRef.current = planMode

    gsap.killTweensOf([slot, ribbon, framing])

    gsap.set(showEl, { position: 'relative', width: '100%', visibility: 'visible' })
    gsap.set(hideEl, { position: 'absolute', top: 0, left: 0, right: 0, visibility: 'visible' })

    const nextHeight = showEl.offsetHeight

    if (firstPaint) {
      gsap.set(slot, { height: nextHeight, overflow: 'hidden' })
      gsap.set(showEl, { opacity: 1, y: 0, pointerEvents: 'auto' })
      gsap.set(hideEl, { opacity: 0, y: 0, pointerEvents: 'none' })
      return
    }

    gsap.set(slot, { height: slot.offsetHeight, overflow: 'hidden' })

    gsap
      .timeline({ defaults: { ease: 'power2.inOut' } })
      .to(slot, { height: nextHeight, duration: DURATION }, 0)
      .to(
        hideEl,
        {
          opacity: 0,
          y: toFraming ? -10 : 10,
          duration: DURATION * 0.72,
          ease: 'power2.in',
          pointerEvents: 'none',
        },
        0,
      )
      .fromTo(
        showEl,
        { opacity: 0, y: toFraming ? 10 : -10 },
        { opacity: 1, y: 0, duration: DURATION * 0.85, ease: 'power2.out', pointerEvents: 'auto' },
        DURATION * 0.18,
      )
  }, [
    planMode,
    hasEquipment,
    customMosaic,
    isMosaic,
    horizontalPanels,
    verticalPanels,
    horizontalOverlapPercent,
    verticalOverlapPercent,
    panelCount,
    markers.length,
    ribbonHourStartsSec.length,
    weatherColorsKnown,
  ])

  return (
    <div ref={slotRef} className="relative w-full overflow-hidden">
      <div ref={ribbonRef} className="mt-2 w-full" aria-hidden={planMode === 'framing'}>
        <PlanRibbon
          barRef={barRef}
          ribbonStartSec={ribbonStartSec}
          ribbonEndSec={ribbonEndSec}
          ribbonHourStartsSec={ribbonHourStartsSec}
          weatherColorsKnown={weatherColorsKnown}
          readySet={readySet}
          markers={markers}
          hoverFrac={hoverFrac}
          onHoverFrac={onHoverFrac}
          onRibbonClick={onRibbonClick}
          onReturnToNow={onReturnToNow}
          stelReady={stelReady}
        />
      </div>
      <div
        ref={framingRef}
        className="flex w-full items-center justify-center px-1 pt-4"
        aria-hidden={planMode === 'atlas'}
      >
        <PlanFramingToolbar
          hasEquipment={hasEquipment}
          customMosaic={customMosaic}
          isMosaic={isMosaic}
          horizontalPanels={horizontalPanels}
          verticalPanels={verticalPanels}
          horizontalOverlapPercent={horizontalOverlapPercent}
          verticalOverlapPercent={verticalOverlapPercent}
          panelCount={panelCount}
          onCustomMosaic={onCustomMosaic}
          onHorizontalPanels={onHorizontalPanels}
          onVerticalPanels={onVerticalPanels}
          onHorizontalOverlapPercent={onHorizontalOverlapPercent}
          onVerticalOverlapPercent={onVerticalOverlapPercent}
          onAddPanel={onAddPanel}
          customPanels={customPanels}
          deletePanelId={deletePanelId}
          onDeletePanelIdChange={onDeletePanelIdChange}
          selectedPanelCoords={selectedPanelCoords}
          onSelectedPanelCoords={onSelectedPanelCoords}
          onDeletePanel={onDeletePanel}
        />
      </div>
    </div>
  )
}
