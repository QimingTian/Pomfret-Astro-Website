'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  getTonightScheduleEveningAstronomyUtc,
  getTonightScheduleMorningAstronomyUtc,
  OBSERVATORY_TIME_ZONE,
} from '@/lib/sunrise-window'
import { getTonightScheduleWindowSec } from '@/lib/schedule-strip'
import { useCameraFrameOverlay } from '@/lib/imaging/equipment/use-camera-frame-overlay'
import { overlayRotationDeg } from '@/lib/imaging/equipment/equipment'
import { useImagingRigs } from '@/lib/imaging/equipment/useEquipment'
import { computeFovOverlayRotationDeg, raDecToScreenDelta, screenDeltaToRaDec } from '@/lib/fov-overlay'
import { calculateMosaicPanels } from '@/lib/mosaic/calculate-mosaic-panels'
import {
  defaultPositionAngleDeg,
} from '@/lib/mosaic/panel-coordinates'
import { PLAN_MOSAIC_DRAFT_KEY } from '@/lib/mosaic/framing-rectangle'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'
import {
  glassPillMd,
} from '@/lib/glass-ui'
import { PlanModeSwitch, type PlanMode } from './plan-mode-switch'
import { PlanTimelineSlot } from './plan-timeline-slot'
import { PlanSkyLayers, LAYER_ORDER, type LayerKey } from './plan-sky-layers'
import { PlanFramingToolbar, PlanFrameOverlays } from './plan-framing-toolbar'
import { PlanSelectionOverlay, type LiveSkyInfo } from './plan-selection-overlay'
import { formatDecDegDms, formatRaHoursHms } from '@/lib/format-radec'

const POMFRET_LATITUDE = 41.9159
const POMFRET_LONGITUDE = -71.9626
const POMFRET_ALTITUDE_METERS = 150

type WeatherPrediction = {
  ok: boolean
  prediction?: 'permitted' | 'not_permitted' | 'unavailable'
  nightHourStartsSec?: number[]
  readyHourStartsSec?: number[]
  notPermittedHourReasons?: Array<{ hourStartSec: number; reasons: Array<'cloud' | 'rain' | 'wind'> }>
}

type ResolvedCatalogObject = {
  query: string
  canonicalName: string
  aliases: string[]
  raHours: number
  decDeg: number
  ra: { hour: number; minute: number; second: number }
  dec: { sign: '+' | '-'; degree: number; minute: number; second: number }
}

/** A SweObj-shaped handle as exposed by the engine's JS glue. We only touch
 * the members we actually need: `.icrs` (4-vec containing unit RA/Dec) and
 * pass it back to `stel.pointAndLock`. Intentionally loose — the engine
 * returns null / object, and we guard accordingly. */
type SweObj = {
  icrs?: number[]
  radec?: number[]
  id?: string
  type?: string
  getInfo?: (key: string) => unknown
} | null

/** Payload from iframe pomfretPostSelectionInfo (engine getInfo keys). */
type SelectionInfoPayload = {
  id: string
  rows: Array<{ label: string; value: string }>
}

/** Minimum engine surface the Atlas parent needs. The engine also exposes
 * getObj / pointAndLock / convertFrame / c2s at the top level of `stel`
 * (not nested under core). */
type LayerToggleTarget = { visible?: boolean }
type Observer = { utc?: number; yaw?: number; pitch?: number }
type StelLike = {
  core?: {
    fov?: number
    selection?: SweObj
    /** Sidereal tracking target from `pointAndLock`; set null to unlock without moving the view. */
    lock?: SweObj
    observer?: Observer
    landscapes?: LayerToggleTarget
    atmosphere?: LayerToggleTarget
    dsos?: LayerToggleTarget
    dss?: LayerToggleTarget
    lines?: { azimuthal?: LayerToggleTarget; equatorial?: LayerToggleTarget }
  }
  getObj?: (name: string) => SweObj
  pointAndLock?: (obj: NonNullable<SweObj>, duration: number) => void
  convertFrame?: (obs: Observer, origin: string, dest: string, v: number[]) => number[]
  c2s?: (v: number[]) => [number, number]
}

/** Stellarium Web `c2s` expects a 4-component direction; see `public/stellarium/engine.html` (`pomfretSexagesimalRaDec`). */
function icrfDirToRaDecHoursDeg(stel: Pick<StelLike, 'c2s'>, vec: number[]): { raHours: number; decDeg: number } | null {
  if (!stel.c2s || !vec || vec.length < 3) return null
  try {
    const s = stel.c2s([vec[0], vec[1], vec[2], vec.length > 3 ? vec[3] || 0 : 0])
    if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) return null
    return {
      raHours: (((s[0] * 12) / Math.PI) % 24 + 24) % 24,
      decDeg: (s[1] * 180) / Math.PI,
    }
  } catch {
    return null
  }
}

function formatHourMinute(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function buildHourStartsSec(windowStartSec: number, windowEndSec: number): number[] {
  if (!Number.isFinite(windowStartSec) || !Number.isFinite(windowEndSec) || windowEndSec <= windowStartSec) {
    return []
  }
  const hours: number[] = []
  for (let sec = windowStartSec; sec < windowEndSec; sec += 3600) {
    hours.push(sec)
  }
  return hours
}

/** Local date + time to the minute for the time-travel scrubber hover label. */
function formatHoverTimeToMinute(sec: number): string {
  const d = new Date(sec * 1000)
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timePart = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return `${datePart} ${timePart}`
}

/** Same MJD convention as `public/stellarium/engine.html` `dateToMJD`. */
function dateToMJD(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5 - 2400000.5
}

type AtlasRibbonAstronomyMarker = { id: string; label: string; sec: number; frac: number }

/** Wall time for ribbon astronomy ticks (matches Remote schedule timezone). */
function formatRibbonAstronomyTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, {
    timeZone: OBSERVATORY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function usePolling<T>(fn: () => Promise<T | null>, intervalMs: number): T | null {
  const [state, setState] = useState<T | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const v = await fn()
        if (!cancelled) setState(v)
      } catch {
        if (!cancelled) setState(null)
      }
    }
    void load()
    const id = window.setInterval(load, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])
  return state
}

/** Resolve the engine object whose `visible` owns the given layer. */
function layerObj(stel: StelLike | null, k: LayerKey): LayerToggleTarget | null {
  const core = stel?.core
  if (!core) return null
  if (k === 'azimuthal') return core.lines?.azimuthal ?? null
  if (k === 'equatorial') return core.lines?.equatorial ?? null
  if (k === 'dss') return core.dss ?? null
  return core[k] ?? null
}

/** Engine getObj is a case-insensitive exact-designation match against every
 * child's designation list (core.c `on_designation` -> `strcasecmp`). Simple
 * strings like "Vega" don't always hit; a short set of variants covers most
 * common shapes (plain, upper-cased, compact, with "NAME " prefix). */
function tryEngineGetObj(stel: StelLike | null, candidates: string[]): NonNullable<SweObj> | null {
  const getObj = stel?.getObj
  if (!getObj) return null
  const seen = new Set<string>()
  for (const raw of candidates) {
    if (!raw) continue
    const variants = [raw, raw.toUpperCase(), raw.replace(/\s+/g, ''), `NAME ${raw}`, `NAME ${raw.toUpperCase()}`]
    for (const v of variants) {
      const key = v.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      try {
        const o = getObj(key)
        if (o) return o
      } catch {
        /* ignore engine throws */
      }
    }
  }
  return null
}

/** Extra designation shapes so Sesame-resolved names more often match the engine catalog (getObj). */
function buildEngineResolveCandidates(resolved: ResolvedCatalogObject, rawQuery: string): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (t) out.add(t)
  }
  add(rawQuery)
  add(resolved.canonicalName)
  for (const a of resolved.aliases ?? []) add(a)
  for (const s of Array.from(out)) {
    const ngc = s.match(/\b(NGC|IC)\s*(\d{1,5})\b/i)
    if (ngc) {
      const abbr = ngc[1]!.toUpperCase()
      const num = ngc[2]!
      add(`${abbr} ${num}`)
      add(`${abbr}${num}`)
    }
    const mess = s.match(/\bM\s*(\d{1,3})\b/i) ?? s.match(/\bMessier\s+(\d{1,3})\b/i)
    if (mess) {
      const n = mess[1]!
      add(`M ${n}`)
      add(`M${n}`)
    }
  }
  return Array.from(out)
}

export default function PlanPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const tonightRibbonBarRef = useRef<HTMLDivElement | null>(null)
  const cameraFrameOverlayRef = useRef<HTMLDivElement | null>(null)
  const mosaicOverlayRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const { rigs, selectedRig: equipment, selectedRigIndex, setSelectedRigIndex } = useImagingRigs()
  const [planMode, setPlanMode] = useState<PlanMode>('atlas')
  /** Framing always locks the sky; Atlas pans freely. */
  const skyLocked = planMode === 'framing'
  const [boresight, setBoresight] = useState<{ raHours: number; decDeg: number } | null>(null)
  const boresightRef = useRef<{ raHours: number; decDeg: number } | null>(null)

  useEffect(() => {
    boresightRef.current = boresight
  }, [boresight])
  const [horizontalPanels, setHorizontalPanels] = useState(1)
  const [verticalPanels, setVerticalPanels] = useState(1)
  const [horizontalOverlapPercent, setHorizontalOverlapPercent] = useState(10)
  const [verticalOverlapPercent, setVerticalOverlapPercent] = useState(10)
  const [customMosaic, setCustomMosaic] = useState(false)
  const [customPanels, setCustomPanels] = useState<MosaicPanel[]>([])
  const customPanelIdRef = useRef(1)
  const customPanelDragRef = useRef<{
    panelId: number
    lastX: number
    lastY: number
    x: number
    y: number
  } | null>(null)
  /** Failed commit: keep overlay on these screen pixels until next drag. */
  const customScreenPinRef = useRef<{ panelId: number; x: number; y: number } | null>(null)
  const [deletePanelId, setDeletePanelId] = useState(1)
  const prevPlanModeRef = useRef<PlanMode>(planMode)
  const frameOffsetRef = useRef({ x: 0, y: 0 })
  const frameDragStartScreenOffsetRef = useRef({ x: 0, y: 0 })
  const frameDragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  })
  const [viewerReady, setViewerReady] = useState(false)
  const [stelReady, setStelReady] = useState(false)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    landscapes: true,
    atmosphere: false,
    dsos: true,
    dss: true,
    azimuthal: false,
    equatorial: false,
  })
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [trackingTarget, setTrackingTarget] = useState<{ name: string; raHours: number; decDeg: number } | null>(null)
  /** `engine-lock` = stel.pointAndLock; `continuous` = RAF ICRF recenter fallback. */
  const trackingSourceRef = useRef<'engine-lock' | 'continuous' | null>(null)

  const [alt30OverlayOn, setAlt30OverlayOn] = useState(false)
  const [orbitOverlayOn, setOrbitOverlayOn] = useState(false)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfoPayload | null>(null)
  const [liveSkyInfo, setLiveSkyInfo] = useState<LiveSkyInfo>({ kind: 'view', center: null })

  const viewerSrc = useMemo(
    () =>
      `/stellarium/engine.html?${new URLSearchParams({
        lat: String(POMFRET_LATITUDE),
        lng: String(POMFRET_LONGITUDE),
        elev: String(POMFRET_ALTITUDE_METERS),
      }).toString()}`,
    [],
  )

  const getStel = useCallback((): StelLike | null => {
    const iframe = iframeRef.current
    if (!iframe) return null
    const win = iframe.contentWindow as (Window & { stel?: StelLike }) | null
    return win?.stel ?? null
  }, [])

  /** Stop sidereal tracking without moving the camera (drag / Atlas↔Framing). */
  const clearSkyTracking = useCallback(() => {
    trackingSourceRef.current = null
    setTrackingTarget(null)
    try {
      const stel = getStel()
      if (stel?.core) stel.core.lock = null
    } catch {
      /* ignore */
    }
  }, [getStel])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev?.data
      if (!d || typeof d !== 'object' || d.source !== 'pomfret-stellarium') return
      if (d.type === 'ready') {
        setStelReady(true)
        setViewerReady(true)
      }
      if (d.type === 'selection-info') {
        const p = d.payload as SelectionInfoPayload | null | undefined
        setSelectionInfo(p && typeof p === 'object' && Array.isArray(p.rows) ? p : null)
      }
      /* Engine pan (or lock cleared): unlock only — keep current view. */
      if (d.type === 'sky-unlocked') {
        trackingSourceRef.current = null
        setTrackingTarget(null)
      }
    }
    window.addEventListener('message', onMessage)
    let attempts = 0
    const poll = window.setInterval(() => {
      const win = iframeRef.current?.contentWindow as (Window & { stel?: unknown }) | null
      if (win?.stel) {
        setStelReady(true)
        setViewerReady(true)
        window.clearInterval(poll)
      } else if (++attempts > 120) {
        window.clearInterval(poll)
      }
    }, 500)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    if (!stelReady) return
    const stel = getStel()
    setLayers((prev) => {
      const next = { ...prev }
      for (const k of LAYER_ORDER) {
        const obj = layerObj(stel, k)
        if (obj && typeof obj.visible === 'boolean') next[k] = obj.visible
      }
      return next
    })
  }, [stelReady, getStel])

  /* Pomfret engine overlays + framing mode bridge. */
  useEffect(() => {
    if (!stelReady) return
    const w = iframeRef.current?.contentWindow
    if (!w) return
    try {
      w.postMessage({ source: 'pomfret-atlas', type: 'overlay-alt30', visible: alt30OverlayOn }, '*')
      w.postMessage({ source: 'pomfret-atlas', type: 'overlay-orbit', visible: orbitOverlayOn }, '*')
      w.postMessage(
        {
          source: 'pomfret-atlas',
          type: 'set-framing-mode',
          enabled: planMode === 'framing',
          skyLocked,
        },
        '*',
      )
    } catch {
      /* ignore */
    }
  }, [stelReady, alt30OverlayOn, orbitOverlayOn, planMode, skyLocked])

  const mosaicBaseInput = useMemo(() => {
    if (planMode !== 'framing' || !equipment || !stelReady) return null
    const stel = getStel()
    const obs = stel?.core?.observer
    const fov = stel?.core?.fov
    const iframe = iframeRef.current
    if (!stel || !obs || !stel.convertFrame || !stel.c2s || typeof fov !== 'number' || !iframe) {
      return null
    }
    let centerRa = 0
    let centerDec = 0
    if (boresight) {
      centerRa = boresight.raHours
      centerDec = boresight.decDeg
    } else {
      try {
        const vICRF = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
        const conv = icrfDirToRaDecHoursDeg(stel, vICRF)
        if (conv) {
          centerRa = conv.raHours
          centerDec = conv.decDeg
        }
      } catch {
        return null
      }
    }
    const h = iframe.clientHeight || 520
    const w = iframe.clientWidth || 800
    const vFovDeg = (fov * 180) / Math.PI
    const hFovDeg = vFovDeg * (w / h)
    const pa = overlayRotationDeg(equipment)
    const stelFov = stel as import('@/lib/fov-overlay').FovOverlayStel
    // Snapshot field rotation at mosaic center once per boresight/layout change.
    // Do NOT re-read live parallactic angle every frame — that would drift panel RA/Dec
    // while the locked frame and sky stay fixed (Custom stores coords for the same reason).
    const rotAtCenter =
      computeFovOverlayRotationDeg(stelFov, pa, centerRa, centerDec) ??
      computeFovOverlayRotationDeg(stelFov, pa) ??
      pa
    return {
      centerRaHours: centerRa,
      centerDecDeg: centerDec,
      horizontalPanels,
      verticalPanels,
      horizontalOverlapPercent: horizontalOverlapPercent / 100,
      verticalOverlapPercent: verticalOverlapPercent / 100,
      equipment,
      viewportWidthPx: w,
      viewportHeightPx: h,
      viewportHFovDeg: hFovDeg,
      viewportVFovDeg: vFovDeg,
      viewportRotationDeg: rotAtCenter - pa,
      previousRotationDeg: pa,
      fieldRotationDegAt: () => rotAtCenter,
    }
  }, [
    planMode,
    equipment,
    stelReady,
    boresight,
    horizontalPanels,
    verticalPanels,
    horizontalOverlapPercent,
    verticalOverlapPercent,
    getStel,
  ])

  const mosaicResult = useMemo(() => {
    if (!mosaicBaseInput) {
      return { isMosaic: false, panels: [] as MosaicPanel[] }
    }
    return calculateMosaicPanels(mosaicBaseInput)
  }, [mosaicBaseInput])

  const framingPanels = customMosaic ? customPanels : mosaicResult.panels
  const framingUsePanelOverlays = customMosaic ? customPanels.length > 0 : mosaicResult.isMosaic
  const framingIsMosaic = customMosaic ? customPanels.length > 1 : mosaicResult.isMosaic

  const getViewCenterRaDec = useCallback((): { raHours: number; decDeg: number } | null => {
    const stel = getStel()
    const obs = stel?.core?.observer
    if (!stel?.convertFrame || !stel.c2s || !obs) return null
    try {
      const vICRF = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
      return icrfDirToRaDecHoursDeg(stel, vICRF)
    } catch {
      return null
    }
  }, [getStel])

  const panelCoordsFromScreenOffset = useCallback(
    (screenDeltaXPx: number, screenDeltaYPx: number, seed?: { raHours: number; decDeg: number } | null) => {
      const stel = getStel() as import('@/lib/fov-overlay').FovOverlayStel | null
      const fov = stel?.core?.fov
      const iframe = iframeRef.current
      const h = iframe?.clientHeight ?? 0
      if (!stel || typeof fov !== 'number' || fov <= 0 || h <= 0) return null
      return screenDeltaToRaDec(stel, screenDeltaXPx, screenDeltaYPx, h, fov, seed)
    },
    [getStel],
  )

  const panelScreenOffsetFromRaDec = useCallback(
    (raHours: number, decDeg: number) => {
      const stel = getStel() as import('@/lib/fov-overlay').FovOverlayStel | null
      const fov = stel?.core?.fov
      const iframe = iframeRef.current
      const h = iframe?.clientHeight ?? 0
      if (!stel || typeof fov !== 'number' || fov <= 0 || h <= 0) return null
      return raDecToScreenDelta(stel, raHours, decDeg, h, fov)
    },
    [getStel],
  )

  const gridLayout = useMemo(
    () =>
      customMosaic
        ? null
        : {
            horizontalPanels,
            verticalPanels,
            horizontalOverlapPercent: horizontalOverlapPercent / 100,
            verticalOverlapPercent: verticalOverlapPercent / 100,
          },
    [customMosaic, horizontalPanels, verticalPanels, horizontalOverlapPercent, verticalOverlapPercent],
  )

  const getGridBoresightCenter = useCallback((): { raHours: number; decDeg: number } | null => {
    return boresightRef.current ?? boresight ?? getViewCenterRaDec()
  }, [boresight, getViewCenterRaDec])

  /** Live center while dragging Grid — labels only. Overlay must NOT use this for draw. */
  const getGridScreenSkyCenter = useCallback((): { raHours: number; decDeg: number } | null => {
    if (frameDragRef.current.active) {
      const offset = frameOffsetRef.current
      const seed = getGridBoresightCenter()
      return panelCoordsFromScreenOffset(offset.x, offset.y, seed) ?? seed
    }
    return getGridBoresightCenter()
  }, [getGridBoresightCenter, panelCoordsFromScreenOffset])

  const resetFrameScreenOffset = useCallback(() => {
    frameOffsetRef.current = { x: 0, y: 0 }
    frameDragStartScreenOffsetRef.current = { x: 0, y: 0 }
  }, [])

  const getGridDisplayPanels = useCallback((): MosaicPanel[] => {
    if (customMosaic || !mosaicBaseInput) return framingPanels
    const center = getGridScreenSkyCenter()
    if (!center) return framingPanels
    // Same stable fieldRotationDegAt as mosaicBaseInput (not live parallactic).
    return calculateMosaicPanels({
      ...mosaicBaseInput,
      centerRaHours: center.raHours,
      centerDecDeg: center.decDeg,
    }).panels
  }, [customMosaic, mosaicBaseInput, framingPanels, getGridScreenSkyCenter])

  const liveSkyInfoKeyRef = useRef('')
  const liveSkyDepsRef = useRef({
    planMode,
    customMosaic,
    customPanels,
    framingPanels,
    framingUsePanelOverlays,
    getViewCenterRaDec,
    getGridScreenSkyCenter,
    getGridDisplayPanels,
    panelCoordsFromScreenOffset,
    frameDragRef,
    frameOffsetRef,
    customPanelDragRef,
    boresightRef,
  })
  liveSkyDepsRef.current = {
    planMode,
    customMosaic,
    customPanels,
    framingPanels,
    framingUsePanelOverlays,
    getViewCenterRaDec,
    getGridScreenSkyCenter,
    getGridDisplayPanels,
    panelCoordsFromScreenOffset,
    frameDragRef,
    frameOffsetRef,
    customPanelDragRef,
    boresightRef,
  }

  useEffect(() => {
    if (!stelReady) return
    let rafId = 0
    const tick = () => {
      const d = liveSkyDepsRef.current
      let next: LiveSkyInfo
      if (d.planMode !== 'framing') {
        next = { kind: 'view', center: d.getViewCenterRaDec() }
      } else if (d.customMosaic) {
        const dragging = d.customPanelDragRef.current
        next = {
          kind: 'mosaic',
          panels: d.customPanels.map((p) => {
            // Labels: live engine coords from screenDelta while dragging; stored RA when idle.
            if (dragging && dragging.panelId === p.id) {
              const coords =
                d.panelCoordsFromScreenOffset(dragging.x, dragging.y, {
                  raHours: p.raHours,
                  decDeg: p.decDeg,
                }) ?? { raHours: p.raHours, decDeg: p.decDeg }
              return { id: p.id, name: p.name || `Panel ${p.id}`, center: coords }
            }
            return {
              id: p.id,
              name: p.name || `Panel ${p.id}`,
              center: { raHours: p.raHours, decDeg: p.decDeg },
            }
          }),
        }
      } else if (d.framingUsePanelOverlays) {
        const panels = d.frameDragRef.current.active
          ? d.getGridDisplayPanels()
          : d.framingPanels
        next = {
          kind: 'mosaic',
          panels: panels.map((p) => ({
            id: p.id,
            name: p.name || `Panel ${p.id}`,
            center: { raHours: p.raHours, decDeg: p.decDeg },
          })),
        }
      } else {
        const offset = d.frameOffsetRef.current
        const atViewCenter = !offset || Math.hypot(offset.x, offset.y) < 0.5
        next = {
          kind: 'frame',
          center: d.frameDragRef.current.active
            ? (d.getGridScreenSkyCenter() ?? d.getViewCenterRaDec())
            : atViewCenter
              ? d.getViewCenterRaDec()
              : (d.boresightRef.current ?? d.getViewCenterRaDec()),
        }
      }

      const key =
        next.kind === 'mosaic'
          ? `m:${next.panels.map((p) => `${p.id}:${p.center.raHours.toFixed(5)}:${p.center.decDeg.toFixed(4)}`).join('|')}`
          : `${next.kind}:${next.center ? `${next.center.raHours.toFixed(5)}:${next.center.decDeg.toFixed(4)}` : 'null'}`
      if (key !== liveSkyInfoKeyRef.current) {
        liveSkyInfoKeyRef.current = key
        setLiveSkyInfo(next)
      }
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [stelReady])

  const cameraFrameProfile = useCameraFrameOverlay({
    enabled: planMode === 'framing' && equipment != null,
    equipment,
    stelReady,
    getStel: () => getStel() as import('@/lib/fov-overlay').FovOverlayStel | null,
    iframeRef,
    overlayRef: cameraFrameOverlayRef,
    frameOffsetRef,
    mosaicOverlayRefs,
    mosaicPanels: framingPanels,
    isMosaic: framingUsePanelOverlays,
    useSensorLayout: !customMosaic,
    gridLayout,
    // Stable boresight only — never live engine inverse (that made Grid vibrate while dragging).
    getGridScreenSkyCenter: customMosaic ? undefined : getGridBoresightCenter,
    getViewCenterRaDec,
    getCustomDragVisual: () => customPanelDragRef.current ?? customScreenPinRef.current,
  })

  const gridPanelGroupDraggable =
    !customMosaic && skyLocked && framingUsePanelOverlays

  const getLiveFramingPanelsForSend = useCallback((): MosaicPanel[] => {
    if (customMosaic) {
      return customPanels.map((p) => {
        const coords = panelCoordsFromScreenOffset(p.screenDeltaXPx, p.screenDeltaYPx, {
          raHours: p.raHours,
          decDeg: p.decDeg,
        })
        return coords ? { ...p, raHours: coords.raHours, decDeg: coords.decDeg } : p
      })
    }
    if (!customMosaic && mosaicBaseInput) {
      return calculateMosaicPanels(mosaicBaseInput).panels
    }
    return framingPanels
  }, [customMosaic, customPanels, panelCoordsFromScreenOffset, mosaicBaseInput, framingPanels])

  const commitFrameOffset = useCallback(() => {
    const start = frameDragStartScreenOffsetRef.current
    const current = frameOffsetRef.current
    const delta = { x: current.x - start.x, y: current.y - start.y }
    if (delta.x === 0 && delta.y === 0) return
    const view = getViewCenterRaDec()
    const seed = view ?? boresightRef.current
    const next = panelCoordsFromScreenOffset(current.x, current.y, seed)
    if (!next) {
      frameDragStartScreenOffsetRef.current = { ...current }
      return
    }
    const committed = { raHours: next.raHours, decDeg: next.decDeg }
    boresightRef.current = committed
    setBoresight(committed)
    frameDragStartScreenOffsetRef.current = { ...current }
  }, [getViewCenterRaDec, panelCoordsFromScreenOffset])

  const handleFramePointerDown = useCallback((e: React.PointerEvent) => {
    if (planMode !== 'framing') return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    frameDragStartScreenOffsetRef.current = { ...frameOffsetRef.current }
    frameDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
  }, [planMode])

  const handleFramePointerMove = useCallback((e: React.PointerEvent) => {
    if (!frameDragRef.current.active) return
    const dx = e.clientX - frameDragRef.current.lastX
    const dy = e.clientY - frameDragRef.current.lastY
    frameDragRef.current.lastX = e.clientX
    frameDragRef.current.lastY = e.clientY
    frameOffsetRef.current.x += dx
    frameOffsetRef.current.y += dy
  }, [])

  const handleFramePointerUp = useCallback(() => {
    if (!frameDragRef.current.active) return
    frameDragRef.current.active = false
    commitFrameOffset()
  }, [commitFrameOffset])

  const handleCustomMosaicChange = useCallback(
    (on: boolean) => {
      if (on) {
        const center = getViewCenterRaDec()
        const pa = equipment ? defaultPositionAngleDeg(null, overlayRotationDeg(equipment), 0) : 0
        setCustomPanels([
          {
            id: 1,
            raHours: center?.raHours ?? 0,
            decDeg: center?.decDeg ?? 0,
            positionAngleDeg: pa,
            name: 'Panel 1',
            screenDeltaXPx: 0,
            screenDeltaYPx: 0,
          },
        ])
        customPanelIdRef.current = 2
      } else {
        setCustomPanels([])
      }
      setCustomMosaic(on)
    },
    [equipment, getViewCenterRaDec],
  )

  const handleAddCustomPanel = useCallback(() => {
    if (!equipment) return
    const used = new Set(customPanels.map((p) => p.id))
    let id = 1
    while (used.has(id)) id++
    customPanelIdRef.current = id + 1
    const n = customPanels.length
    const screenDeltaXPx = ((n % 3) - 1) * 48
    const screenDeltaYPx = (Math.floor(n / 3) - (n > 0 ? 0 : 0)) * 48
    const center = getViewCenterRaDec()
    const coords = panelCoordsFromScreenOffset(screenDeltaXPx, screenDeltaYPx, center)
    // Reject wrong-branch inverses on add (same failure mode as Panel 3 → 09h/−45°).
    let raHours = center?.raHours ?? 0
    let decDeg = center?.decDeg ?? 0
    if (coords && center) {
      const dRaH = Math.abs(coords.raHours - center.raHours)
      const dRaWrapped = Math.min(dRaH, 24 - dRaH) * 15
      const dDec = Math.abs(coords.decDeg - center.decDeg)
      if (dRaWrapped <= 20 && dDec <= 20) {
        raHours = coords.raHours
        decDeg = coords.decDeg
      }
    } else if (coords) {
      raHours = coords.raHours
      decDeg = coords.decDeg
    }
    setCustomPanels((prev) => [
      ...prev,
      {
        id,
        raHours,
        decDeg,
        positionAngleDeg: defaultPositionAngleDeg(null, overlayRotationDeg(equipment), 0),
        name: `Panel ${id}`,
        screenDeltaXPx,
        screenDeltaYPx,
      },
    ])
  }, [customPanels, equipment, getViewCenterRaDec, panelCoordsFromScreenOffset])

  const handleDeleteCustomPanel = useCallback(() => {
    setCustomPanels((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((p) => p.id !== deletePanelId)
      return next.length > 0 ? next : prev
    })
  }, [deletePanelId])

  const selectedPanelCoords = useMemo(() => {
    if (!customMosaic) return null
    const panel = customPanels.find((p) => p.id === deletePanelId)
    if (!panel) return null
    return { raHours: panel.raHours, decDeg: panel.decDeg }
  }, [customMosaic, customPanels, deletePanelId])

  const handleSelectedPanelCoords = useCallback(
    (raHours: number, decDeg: number) => {
      // Coord edit owns the panel — drop any post-drag screen pin or the frame stays stuck.
      if (customScreenPinRef.current?.panelId === deletePanelId) {
        customScreenPinRef.current = null
      }
      const offset = panelScreenOffsetFromRaDec(raHours, decDeg)
      setCustomPanels((prev) =>
        prev.map((p) => {
          if (p.id !== deletePanelId) return p
          return {
            ...p,
            raHours,
            decDeg,
            screenDeltaXPx: offset?.x ?? p.screenDeltaXPx,
            screenDeltaYPx: offset?.y ?? p.screenDeltaYPx,
          }
        }),
      )
    },
    [deletePanelId, panelScreenOffsetFromRaDec],
  )

  useEffect(() => {
    if (!customMosaic) return
    setDeletePanelId((id) => {
      if (customPanels.some((p) => p.id === id)) return id
      return customPanels[0]?.id ?? 1
    })
  }, [customMosaic, customPanels])

  useEffect(() => {
    const prev = prevPlanModeRef.current
    prevPlanModeRef.current = planMode
    if (prev !== planMode) {
      /* Atlas ↔ Framing: unlock tracking only — do not slew back to the locked target. */
      clearSkyTracking()
    }
    if (planMode === 'framing' && prev === 'atlas') {
      if (!customMosaic) {
        const view = getViewCenterRaDec()
        if (view) {
          boresightRef.current = view
          setBoresight({ raHours: view.raHours, decDeg: view.decDeg })
        }
      }
      resetFrameScreenOffset()
    } else if (planMode === 'atlas' && prev === 'framing') {
      resetFrameScreenOffset()
    }
  }, [planMode, customMosaic, getViewCenterRaDec, resetFrameScreenOffset, clearSkyTracking])

  const commitCustomPanelPosition = useCallback(
    (panelId: number, screenX: number, screenY: number): boolean => {
      let ok = false
      setCustomPanels((prev) =>
        prev.map((p) => {
          if (p.id !== panelId) return p
          const coords = panelCoordsFromScreenOffset(screenX, screenY, {
            raHours: p.raHours,
            decDeg: p.decDeg,
          })
          if (!coords) return p
          // Keep the exact drop pixels — do not re-sync from engine (avoids release nudge).
          ok = true
          return {
            ...p,
            raHours: coords.raHours,
            decDeg: coords.decDeg,
            screenDeltaXPx: screenX,
            screenDeltaYPx: screenY,
          }
        }),
      )
      return ok
    },
    [panelCoordsFromScreenOffset],
  )

  const handleCustomPanelPointerDown = useCallback(
    (panelId: number, e: React.PointerEvent) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      customScreenPinRef.current = null
      const panel = customPanels.find((p) => p.id === panelId)
      const fromState = {
        x: panel?.screenDeltaXPx ?? 0,
        y: panel?.screenDeltaYPx ?? 0,
      }
      const fromEngine =
        panel != null ? panelScreenOffsetFromRaDec(panel.raHours, panel.decDeg) : null
      // If stored RA is corrupt, engine origin jumps away from the visible box.
      // Prefer engine only when it agrees with the current screenDelta (or state is ~0).
      const stateIsEmpty = Math.hypot(fromState.x, fromState.y) < 1
      const engineAgrees =
        fromEngine != null &&
        (stateIsEmpty ||
          Math.hypot(fromEngine.x - fromState.x, fromEngine.y - fromState.y) < 80)
      const origin = engineAgrees && fromEngine ? fromEngine : fromState
      customPanelDragRef.current = {
        panelId,
        lastX: e.clientX,
        lastY: e.clientY,
        x: origin.x,
        y: origin.y,
      }
      setCustomPanels((prev) =>
        prev.map((p) =>
          p.id === panelId
            ? { ...p, screenDeltaXPx: origin.x, screenDeltaYPx: origin.y }
            : p,
        ),
      )
    },
    [customPanels, panelScreenOffsetFromRaDec],
  )

  const handleCustomPanelPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = customPanelDragRef.current
    if (!drag) return
    const dx = e.clientX - drag.lastX
    const dy = e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    drag.x += dx
    drag.y += dy
    // Keep React state in sync for labels/commit; visual follows the ref.
    setCustomPanels((prev) =>
      prev.map((p) =>
        p.id === drag.panelId
          ? { ...p, screenDeltaXPx: drag.x, screenDeltaYPx: drag.y }
          : p,
      ),
    )
  }, [])

  const handleCustomPanelPointerUp = useCallback(() => {
    const drag = customPanelDragRef.current
    if (!drag) return
    const { panelId, x, y } = drag
    let ok = false
    flushSync(() => {
      ok = commitCustomPanelPosition(panelId, x, y)
    })
    customPanelDragRef.current = null
    customScreenPinRef.current = ok ? null : { panelId, x, y }
  }, [commitCustomPanelPosition])

  /* Continuous re-centering fallback used when the engine has no catalog
   * match for a Simbad-resolved target. Converts the stored J2000 RA/Dec
   * vector through ICRF -> OBSERVED each tick, and sets observer yaw/pitch
   * so the target stays centered as sidereal time advances. Engine-catalog
   * hits use pointAndLock and skip this. Drag / mode switch clears tracking. */
  useEffect(() => {
    if (planMode !== 'atlas') return
    if (!stelReady || !trackingTarget || trackingSourceRef.current !== 'continuous') return
    const { raHours, decDeg } = trackingTarget
    const raRad = (raHours * Math.PI) / 12
    const decRad = (decDeg * Math.PI) / 180
    const icrfVec = [
      Math.cos(decRad) * Math.cos(raRad),
      Math.cos(decRad) * Math.sin(raRad),
      Math.sin(decRad),
      0,
    ]
    let raf = 0
    const tick = () => {
      const stel = getStel()
      const obs = stel?.core?.observer
      if (!stel || !obs || !stel.convertFrame || !stel.c2s) return
      try {
        const vObs = stel.convertFrame(obs, 'ICRF', 'OBSERVED', icrfVec)
        const [az, alt] = stel.c2s(vObs)
        obs.yaw = az
        obs.pitch = alt
      } catch {
        /* engine may throw during destruction; ignore */
      }
    }
    tick()
    const loop = () => {
      tick()
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [stelReady, trackingTarget, getStel, planMode])

  const toggleLayer = (k: LayerKey) => {
    const stel = getStel()
    const obj = layerObj(stel, k)
    if (!obj) return
    const v = !layers[k]
    obj.visible = v
    setLayers((prev) => ({ ...prev, [k]: v }))
  }

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    const stel = getStel()
    if (!stel) {
      setSearchError('Sky viewer not ready yet.')
      return
    }
    setSearchLoading(true)
    setSearchError(null)

    const syncFramingBoresight = (raHours: number, decDeg: number) => {
      if (planMode !== 'framing') return
      const next = { raHours, decDeg }
      boresightRef.current = next
      setBoresight(next)
      frameOffsetRef.current = { x: 0, y: 0 }
      frameDragStartScreenOffsetRef.current = { x: 0, y: 0 }
    }

    const lockEngineObj = (obj: NonNullable<SweObj>, name: string): boolean => {
      try {
        if (!stel.pointAndLock) return false
        stel.pointAndLock(obj, 1.0)
        if (stel.core) stel.core.fov = (5 * Math.PI) / 180
        /* Read J2000 for Send-to-Remote: prefer icrs/radec unit direction, with the same
         * 4-component c2s convention as the engine overlay; fall back to getInfo('radec'). */
        let raHours = 0
        let decDeg = 0
        const vec = obj.icrs ?? obj.radec
        let fromDir = vec && vec.length >= 3 ? icrfDirToRaDecHoursDeg(stel, vec) : null
        if (!fromDir && typeof obj.getInfo === 'function') {
          try {
            obj.getInfo('radec')
            const pr = obj.getInfo('radec')
            if (Array.isArray(pr) && pr.length >= 3) fromDir = icrfDirToRaDecHoursDeg(stel, pr as number[])
          } catch {
            /* ignore */
          }
        }
        if (fromDir) {
          raHours = fromDir.raHours
          decDeg = fromDir.decDeg
        }
        trackingSourceRef.current = 'engine-lock'
        setTrackingTarget({ name, raHours, decDeg })
        syncFramingBoresight(raHours, decDeg)
        return true
      } catch {
        return false
      }
    }

    /* Path 1: engine local catalog via stel.getObj designation matching. */
    const directHit = tryEngineGetObj(stel, [q])
    if (directHit) {
      if (lockEngineObj(directHit, q)) {
        setSearchLoading(false)
        return
      }
    }

    /* Path 2: Simbad / local catalog backend used by Remote's Target Search. */
    let resolved: ResolvedCatalogObject | null = null
    try {
      const res = await fetch(`/api/imaging/object-resolve?query=${encodeURIComponent(q)}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok === true && data?.object) {
        resolved = data.object as ResolvedCatalogObject
      } else if (typeof data?.error === 'string') {
        setSearchError(data.error)
      } else {
        setSearchError('Target lookup failed.')
      }
    } catch {
      setSearchError('Target lookup failed.')
    }

    if (!resolved) {
      setSearchLoading(false)
      return
    }

    /* Prefer engine SweObj + pointAndLock (sidereal tracking inside the engine).
     * Expanded designations (NGC compact/space, M31 variants, etc.) improve hits after Sesame. */
    const aliasHit = tryEngineGetObj(stel, buildEngineResolveCandidates(resolved, q))
    if (aliasHit) {
      if (lockEngineObj(aliasHit, resolved.canonicalName)) {
        setSearchLoading(false)
        return
      }
    }

    /* Path 3: continuous re-centering via ICRF->OBSERVED each tick. */
    trackingSourceRef.current = 'continuous'
    setTrackingTarget({
      name: resolved.canonicalName,
      raHours: resolved.raHours,
      decDeg: resolved.decDeg,
    })
    if (planMode === 'framing') {
      const next = { raHours: resolved.raHours, decDeg: resolved.decDeg }
      boresightRef.current = next
      setBoresight(next)
      frameOffsetRef.current = { x: 0, y: 0 }
      frameDragStartScreenOffsetRef.current = { x: 0, y: 0 }
    }
    if (stel.core) stel.core.fov = (5 * Math.PI) / 180
    setSearchLoading(false)
  }, [searchQuery, getStel, planMode])

  const handleSendToRemote = useCallback(() => {
    const stel = getStel()
    if (!stel) return
    if (planMode === 'framing' && equipment) {
      const livePanels = getLiveFramingPanelsForSend()
      if (livePanels.length === 0) return
      const targetName = trackingTarget?.name ?? 'Mosaic target'
      const isMosaicSend = customMosaic ? livePanels.length > 1 : livePanels.length > 1 || mosaicResult.isMosaic
      sessionStorage.setItem(
        PLAN_MOSAIC_DRAFT_KEY,
        JSON.stringify({
          targetName,
          panels: livePanels,
          equipmentSnapshot: equipment,
          centerRaHours: livePanels[0]?.raHours ?? 0,
          centerDecDeg: livePanels[0]?.decDeg ?? 0,
        }),
      )
      window.location.href = isMosaicSend
        ? '/dashboard/remote?mosaic=1'
        : `/dashboard/remote?${new URLSearchParams({
            prefillTarget: targetName,
            prefillRa: String(livePanels[0]!.raHours),
            prefillDec: String(livePanels[0]!.decDeg),
          }).toString()}`
      return
    }
    let raHours: number
    let decDeg: number
    let name: string
    const useViewportCenter = planMode === 'framing' && cameraFrameProfile !== null
    if (!useViewportCenter && trackingTarget) {
      ;({ raHours, decDeg, name } = trackingTarget)
    } else {
      const obs = stel.core?.observer
      if (!obs || !stel.convertFrame || !stel.c2s) return
      try {
        const vICRF = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
        const conv = icrfDirToRaDecHoursDeg(stel, vICRF)
        if (!conv) return
        raHours = conv.raHours
        decDeg = conv.decDeg
      } catch {
        return
      }
      name = `Plan view ${formatRaHoursHms(raHours)} ${formatDecDegDms(decDeg)}`
    }
    const params = new URLSearchParams({
      prefillTarget: name,
      prefillRa: raHours.toFixed(6),
      prefillDec: decDeg.toFixed(6),
    }).toString()
    window.location.href = `/dashboard/remote?${params}`
  }, [getStel, trackingTarget, cameraFrameProfile, planMode, equipment, getLiveFramingPanelsForSend, customMosaic, mosaicResult.isMosaic])

  const canSendToRemote =
    planMode === 'framing' &&
    stelReady &&
    (trackingTarget !== null || cameraFrameProfile !== null || framingPanels.length > 0)

  const weather = usePolling<WeatherPrediction | null>(async () => {
    const { startSec, endSec } = getTonightScheduleWindowSec()
    const res = await fetch(
      `/api/imaging/tonight-weather-prediction?startSec=${startSec}&endSec=${endSec}&_=${Date.now()}`,
      { cache: 'no-store' }
    )
    return (await res.json().catch(() => null)) as WeatherPrediction | null
  }, 60_000)

  const { startSec: ribbonStartSec, endSec: ribbonEndSec } = getTonightScheduleWindowSec()
  const readySet = useMemo(() => new Set(weather?.readyHourStartsSec ?? []), [weather?.readyHourStartsSec])

  const apiHourStartsSec =
    weather?.ok === true && Array.isArray(weather.nightHourStartsSec) && weather.nightHourStartsSec.length > 0
      ? weather.nightHourStartsSec
      : null
  const weatherColorsKnown = apiHourStartsSec != null
  const ribbonHourStartsSec = apiHourStartsSec ?? buildHourStartsSec(ribbonStartSec, ribbonEndSec)

  const atlasRibbonAstronomyMarkers = useMemo((): AtlasRibbonAstronomyMarker[] => {
    if (ribbonEndSec <= ribbonStartSec) return []
    const span = ribbonEndSec - ribbonStartSec
    const now = new Date()
    const { civilDuskUtc, nauticalDuskUtc, astronomicalDarkUtc } = getTonightScheduleEveningAstronomyUtc(now)
    const { civilDawnUtc, nauticalDawnUtc, astronomicalDawnUtc } = getTonightScheduleMorningAstronomyUtc(now)
    const raw: Array<Omit<AtlasRibbonAstronomyMarker, 'frac'>> = [
      { id: 'civil-dusk', label: 'Civil Dusk', sec: Math.floor(civilDuskUtc.getTime() / 1000) },
      { id: 'nautical-dusk', label: 'Nautical Dusk', sec: Math.floor(nauticalDuskUtc.getTime() / 1000) },
      { id: 'astro-dark', label: 'Astronomical Dark', sec: Math.floor(astronomicalDarkUtc.getTime() / 1000) },
      { id: 'astro-dawn', label: 'Astronomical Dawn', sec: Math.floor(astronomicalDawnUtc.getTime() / 1000) },
      { id: 'nautical-dawn', label: 'Nautical Dawn', sec: Math.floor(nauticalDawnUtc.getTime() / 1000) },
      { id: 'civil-dawn', label: 'Civil Dawn', sec: Math.floor(civilDawnUtc.getTime() / 1000) },
    ]
    return raw
      .map((m) => ({ ...m, frac: (m.sec - ribbonStartSec) / span }))
      .filter((m) => m.frac >= 0 && m.frac <= 1)
      .sort((a, b) => a.frac - b.frac)
  }, [ribbonStartSec, ribbonEndSec])

  const handleRibbonClick = (ev: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    if (ribbonEndSec <= ribbonStartSec) return
    const stel = getStel()
    const observer = stel?.core?.observer
    if (!observer) return
    const bar = tonightRibbonBarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const clientX = 'clientX' in ev ? ev.clientX : rect.left + rect.width / 2
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const whenSec = ribbonStartSec + frac * (ribbonEndSec - ribbonStartSec)
    const mjd = whenSec / 86400 + 2440587.5 - 2400000.5
    observer.utc = mjd
  }

  const handleReturnToNow = useCallback(() => {
    const stel = getStel()
    const observer = stel?.core?.observer
    if (!observer) return
    observer.utc = dateToMJD(new Date())
  }, [getStel])

  return (
    <div className="pb-8">
      <div className="flex flex-col gap-4">
        {/* Full-bleed wrapper: ml/mr:[calc(50%-50vw)] + w-screen escapes the dashboard layout's
         * mx-auto max-w-[1400px] column so the iframe touches both viewport edges. -mt-8 eats
         * the <main>'s py-8 top padding so the iframe abuts the sticky header's bottom border
         * with no visible "Atlas" title between them. */}
        <div className="relative -mt-8 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] w-screen overflow-hidden bg-black">
          <iframe
            ref={iframeRef}
            src={viewerSrc}
            title="Stellarium sky atlas"
            onLoad={(e) => {
              setViewerReady(true)
              const w = e.currentTarget.contentWindow
              if (!w) return
              const nudge = () => {
                try {
                  w.dispatchEvent(new Event('resize'))
                } catch {
                  /* ignore */
                }
              }
              nudge()
              window.setTimeout(nudge, 100)
              window.setTimeout(nudge, 500)
              window.setTimeout(nudge, 1500)
            }}
            className="block h-[72vh] min-h-[520px] w-full overflow-hidden"
            allow="accelerometer; autoplay; fullscreen; gyroscope; microphone; xr-spatial-tracking"
          />

          {/* Top-left overlay: search + buttons. Wide max-w + input min-w so the placeholder fits. */}
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(calc(100vw-1.5rem),56rem)] flex-col gap-1 sm:max-w-[min(calc(100vw-1.5rem),72rem)]">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSearch()
              }}
              className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap"
            >
              <input
                type="search"
                enterKeyHint="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (searchError) setSearchError(null)
                }}
                placeholder="Vega, M31, NGC 7000, Jupiter..."
                title="Press Enter to search the sky"
                disabled={!stelReady}
                className="plan-glass-field glass-pill w-full min-w-0 flex-1 rounded-full px-3 py-2 text-left text-sm font-normal text-white placeholder:text-white/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[min(100%,30rem)]"
              />
              <button
                type="submit"
                disabled={!stelReady || searchLoading || !searchQuery.trim()}
                className={`shrink-0 ${glassPillMd} disabled:opacity-60`}
              >
                {searchLoading ? 'Searching...' : 'Search Target'}
              </button>
              <PlanModeSwitch mode={planMode} onChange={setPlanMode} disabled={!stelReady} />
              <button
                type="button"
                onClick={handleSendToRemote}
                disabled={!canSendToRemote || planMode !== 'framing'}
                className={`shrink-0 ${glassPillMd} disabled:opacity-40 ${
                  planMode === 'framing' ? '' : 'invisible pointer-events-none'
                }`}
                aria-hidden={planMode !== 'framing'}
                title={
                  canSendToRemote
                    ? framingIsMosaic
                      ? 'Open Remote with mosaic panels'
                      : 'Open Remote with RA/Dec pre-filled'
                    : 'Configure equipment and center on a target'
                }
              >
                {framingIsMosaic ? 'Send mosaic' : 'Send to Remote'}
              </button>
            </form>
            {searchError ? (
              <div className="pointer-events-auto rounded-md bg-black/50 px-2 py-1 text-xs backdrop-blur">
                <span className="text-rose-300">{searchError}</span>
              </div>
            ) : null}
          </div>

          {stelReady ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10">
              <PlanSelectionOverlay selection={selectionInfo} live={liveSkyInfo} />
            </div>
          ) : null}

          {planMode === 'framing' && cameraFrameProfile && stelReady ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <PlanFrameOverlays
                panels={framingPanels}
                overlayRefs={mosaicOverlayRefs}
                showSingle={!framingUsePanelOverlays}
                singleRef={cameraFrameOverlayRef}
                panelInteractive={customMosaic}
                panelGroupDraggable={gridPanelGroupDraggable}
                singleDraggable={!customMosaic && planMode === 'framing' && !framingUsePanelOverlays}
                onSinglePointerDown={handleFramePointerDown}
                onSinglePointerMove={handleFramePointerMove}
                onSinglePointerUp={handleFramePointerUp}
                onGroupPointerDown={handleFramePointerDown}
                onGroupPointerMove={handleFramePointerMove}
                onGroupPointerUp={handleFramePointerUp}
                onPanelPointerDown={handleCustomPanelPointerDown}
                onPanelPointerMove={handleCustomPanelPointerMove}
                onPanelPointerUp={handleCustomPanelPointerUp}
              />
            </div>
          ) : null}

          {!viewerReady && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">
              Loading sky viewer…
            </div>
          )}
        </div>

        <PlanSkyLayers
          layers={layers}
          alt30OverlayOn={alt30OverlayOn}
          orbitOverlayOn={orbitOverlayOn}
          stelReady={stelReady}
          padBottom={planMode === 'framing'}
          showRigs={planMode === 'framing'}
          rigs={rigs}
          selectedRigIndex={selectedRigIndex}
          onSelectRig={setSelectedRigIndex}
          onToggleLayer={toggleLayer}
          onToggleAlt30={() => setAlt30OverlayOn((v) => !v)}
          onToggleOrbit={() => setOrbitOverlayOn((v) => !v)}
        />

        {planMode === 'framing' ? (
          <div className="border-t border-black/10 dark:border-white/10" aria-hidden />
        ) : null}

        <PlanTimelineSlot
          planMode={planMode}
          barRef={tonightRibbonBarRef as React.RefObject<HTMLDivElement>}
          ribbonStartSec={ribbonStartSec}
          ribbonEndSec={ribbonEndSec}
          ribbonHourStartsSec={ribbonHourStartsSec}
          weatherColorsKnown={weatherColorsKnown}
          readySet={readySet}
          markers={atlasRibbonAstronomyMarkers}
          hoverFrac={hoverFrac}
          onHoverFrac={setHoverFrac}
          onRibbonClick={handleRibbonClick}
          onReturnToNow={handleReturnToNow}
          stelReady={stelReady}
          hasEquipment={equipment != null}
          customMosaic={customMosaic}
          isMosaic={framingIsMosaic}
          horizontalPanels={horizontalPanels}
          verticalPanels={verticalPanels}
          horizontalOverlapPercent={horizontalOverlapPercent}
          verticalOverlapPercent={verticalOverlapPercent}
          panelCount={framingPanels.length}
          onCustomMosaic={handleCustomMosaicChange}
          onHorizontalPanels={setHorizontalPanels}
          onVerticalPanels={setVerticalPanels}
          onHorizontalOverlapPercent={setHorizontalOverlapPercent}
          onVerticalOverlapPercent={setVerticalOverlapPercent}
          onAddPanel={handleAddCustomPanel}
          customPanels={customPanels}
          deletePanelId={deletePanelId}
          onDeletePanelIdChange={setDeletePanelId}
          selectedPanelCoords={selectedPanelCoords}
          onSelectedPanelCoords={handleSelectedPanelCoords}
          onDeletePanel={handleDeleteCustomPanel}
        />
      </div>
    </div>
  )
}
