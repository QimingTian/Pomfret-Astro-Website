'use client'

import { useCallback, useState } from 'react'
import { glassPillSm } from '@/lib/glass-ui'

export type UnlockDebugSky = { raHours: number; decDeg: number }

export type UnlockDebugPanelRow = {
  id: number
  name: string
  screenX: number
  screenY: number
  engineRaDec: UnlockDebugSky | null
  stereographicRaDec: UnlockDebugSky | null
  engineProjectedScreen: { x: number; y: number } | null
  engineRoundTripPx: number | null
}

export type UnlockDebugReport = {
  phase: 'before_unlock' | 'after_unlock'
  capturedAt: string
  mode: 'single' | 'grid-mosaic' | 'custom'
  flags: {
    skyLocked: boolean
    customMosaic: boolean
    framingUsePanelOverlays: boolean
    engineInverseReturnedNull: boolean
    usedStereographicFallback: boolean
  }
  counts: {
    panels: number
    horizontalPanels: number
    verticalPanels: number
  }
  viewport: {
    widthPx: number
    heightPx: number
    fovRad: number
    vFovDeg: number
    hFovDeg: number
    scalePxPerRad: number | null
  }
  observer: {
    yawRad: number | null
    pitchRad: number | null
    yawDeg: number | null
    pitchDeg: number | null
  }
  frameOffset: { x: number; y: number }
  screenCentroid: { x: number; y: number } | null
  viewCenter: UnlockDebugSky | null
  boresightState: UnlockDebugSky | null
  boresightRef: UnlockDebugSky | null
  panTarget: UnlockDebugSky | null
  engineSky: UnlockDebugSky | null
  stereographicSky: UnlockDebugSky | null
  targetProjectedScreen: { x: number; y: number } | null
  errors: {
    roundTripPx: number | null
    enginePanDistancePx: number | null
    stereographicPanDistancePx: number | null
    viewCenterMinusTargetRaDeg: number | null
    viewCenterMinusTargetDecDeg: number | null
    targetAtViewCenterPx: number | null
  }
  metrics: {
    /** Field rotation at view center (Lock baseline). */
    overlayRotDeg: number | null
    /** Field rotation at frame sky if observer were centered there (Lock display). */
    dragOverlayRotDeg: number | null
    /** Field rotation at frame sky with current observer (legacy / diagnostic). */
    liveDragOverlayRotDeg: number | null
    arcsecPerPixelX: number | null
    arcsecPerPixelY: number | null
  }
  panels: UnlockDebugPanelRow[]
  observerDeltaFromBefore: { yawDeg: number; pitchDeg: number } | null
}

export type UnlockDebugSession = {
  before: UnlockDebugReport
  after: UnlockDebugReport | null
  panTarget: UnlockDebugSky
  customCentroid: { x: number; y: number } | null
}

export function serializeUnlockDebugReport(report: UnlockDebugReport): string {
  return JSON.stringify(report, null, 2)
}

export function serializeUnlockDebugSession(session: UnlockDebugSession): string {
  return JSON.stringify(
    {
      panTarget: session.panTarget,
      before_unlock: session.before,
      after_unlock: session.after,
    },
    null,
    2,
  )
}

function formatRaHours(raHours: number): string {
  const h = Math.floor(raHours)
  const m = Math.floor((raHours - h) * 60)
  const s = ((raHours - h) * 60 - m) * 60
  return `${h}h ${m}m ${s.toFixed(2)}s`
}

function formatDecDeg(decDeg: number): string {
  const sign = decDeg >= 0 ? '+' : '-'
  const abs = Math.abs(decDeg)
  const d = Math.floor(abs)
  const m = Math.floor((abs - d) * 60)
  const s = ((abs - d) * 60 - m) * 60
  return `${sign}${d}° ${m}' ${s.toFixed(1)}"`
}

function formatSky(sky: UnlockDebugSky | null): string {
  if (!sky) return '—'
  return `${formatRaHours(sky.raHours)}, ${formatDecDeg(sky.decDeg)} (${sky.raHours.toFixed(6)}h, ${sky.decDeg.toFixed(6)}°)`
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(3)
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-white/50">{k}</dt>
      <dd className="break-all text-white/90">{v}</dd>
    </div>
  )
}

function ReportBlock({ title, report }: { title: string; report: UnlockDebugReport }) {
  return (
    <div className="space-y-2 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
      <div className="text-xs font-semibold text-amber-200">{title}</div>
      <div className="text-[10px] text-white/45">{report.capturedAt}</div>
      <dl className="space-y-1.5 font-mono text-[10px] leading-relaxed">
        <Row k="phase" v={report.phase} />
        <Row k="mode" v={report.mode} />
        <Row k="skyLocked" v={String(report.flags.skyLocked)} />
        <Row k="engineInverseNull" v={String(report.flags.engineInverseReturnedNull)} />
        <Row k="stereoFallback" v={String(report.flags.usedStereographicFallback)} />
        <Row k="frameOffset px" v={`${report.frameOffset.x.toFixed(2)}, ${report.frameOffset.y.toFixed(2)}`} />
        <Row k="panTarget" v={formatSky(report.panTarget)} />
        <Row k="engineSky" v={formatSky(report.engineSky)} />
        <Row k="roundTrip px" v={fmtNum(report.errors.roundTripPx)} />
        <Row k="target@center px" v={fmtNum(report.errors.targetAtViewCenterPx)} />
        <Row k="overlayRot° (view ctr)" v={fmtNum(report.metrics.overlayRotDeg)} />
        <Row k="dragRot° (centered)" v={fmtNum(report.metrics.dragOverlayRotDeg)} />
        <Row k="dragRot° (live obs)" v={fmtNum(report.metrics.liveDragOverlayRotDeg)} />
        {report.observerDeltaFromBefore ? (
          <Row
            k="Δobserver°"
            v={`yaw ${report.observerDeltaFromBefore.yawDeg.toFixed(4)} pitch ${report.observerDeltaFromBefore.pitchDeg.toFixed(4)}`}
          />
        ) : null}
      </dl>
    </div>
  )
}

type PanelProps = {
  session: UnlockDebugSession
  onConfirm: () => void
  onDismiss: () => void
}

export function PlanUnlockDebugPanel({ session, onConfirm, onDismiss }: PanelProps) {
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const confirmed = session.after != null

  const copyText = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyHint(label)
      window.setTimeout(() => setCopyHint(null), 2000)
    } catch {
      setCopyHint('Copy failed')
    }
  }, [])

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-[100] flex w-[min(calc(100vw-2rem),26rem)] max-h-[min(78vh,680px)] flex-col rounded-lg border border-amber-400/50 bg-black/92 shadow-lg backdrop-blur">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-white">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-amber-300">Unlock debug</div>
            <p className="text-[10px] text-white/50">Copy JSON before/after centering.</p>
          </div>
          {copyHint ? <span className="shrink-0 text-[10px] text-emerald-300">{copyHint}</span> : null}
        </div>

        <ReportBlock title="① Before Unlock" report={session.before} />
        <div className="my-2">
          <button
            type="button"
            onClick={() => void copyText('Before copied', serializeUnlockDebugReport(session.before))}
            className={`${glassPillSm} w-full border-white/20`}
          >
            Copy before (JSON)
          </button>
        </div>

        {confirmed && session.after ? (
          <>
            <ReportBlock title="② After centering" report={session.after} />
            <div className="my-2 space-y-2">
              <button
                type="button"
                onClick={() => void copyText('After copied', serializeUnlockDebugReport(session.after!))}
                className={`${glassPillSm} w-full border-white/20`}
              >
                Copy after (JSON)
              </button>
              <button
                type="button"
                onClick={() => void copyText('Full session copied', serializeUnlockDebugSession(session))}
                className={`${glassPillSm} w-full border-emerald-400/30 bg-emerald-500/10`}
              >
                Copy full session
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="flex flex-wrap gap-2">
          {!confirmed ? (
            <button
              type="button"
              onClick={onConfirm}
              className={`${glassPillSm} border-amber-400/40 bg-amber-500/20 text-amber-100`}
            >
              Confirm center
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className={glassPillSm}>
            {confirmed ? 'Dismiss' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
