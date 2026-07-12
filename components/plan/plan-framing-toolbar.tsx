'use client'

import { useEffect, useState } from 'react'
import type { MosaicPanel } from '@/lib/mosaic/framing-rectangle'
import { PlanGlassSegmentSwitch } from './plan-glass-segment-switch'

/** Uniform row height; width follows label content. */
const MOSAIC_PILL_H = 'h-10 box-border'
const MOSAIC_PILL =
  `glass-pill ${MOSAIC_PILL_H} inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-white`
const numInputClass =
  'w-9 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-center text-sm font-medium text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
const partInputClass =
  'w-7 min-w-0 border-0 bg-transparent px-0 py-0 text-center font-mono text-xs font-medium tabular-nums text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

function clampPanel(n: number): number {
  return Math.max(1, Math.min(20, Math.round(n)))
}

function parsePanel(raw: string, fallback: number): number {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n)) return fallback
  return clampPanel(n)
}

function parseOverlap(raw: string, fallback: number): number {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(100, n)
}

type SexagesimalParts = {
  raH: string
  raM: string
  raS: string
  decSign: '+' | '-'
  decD: string
  decM: string
  decS: string
}

function sexagesimalFromRadec(raHours: number, decDeg: number): SexagesimalParts {
  const wrapped = ((raHours % 24) + 24) % 24
  const totalRaSec = Math.round(wrapped * 3600)
  const raH = Math.floor(totalRaSec / 3600) % 24
  const raM = Math.floor((totalRaSec - raH * 3600) / 60)
  const raS = totalRaSec - raH * 3600 - raM * 60
  const sign: '+' | '-' = decDeg < 0 ? '-' : '+'
  const absDec = Math.abs(decDeg)
  const totalDecSec = Math.round(absDec * 3600)
  const decD = Math.floor(totalDecSec / 3600)
  const decM = Math.floor((totalDecSec - decD * 3600) / 60)
  const decS = totalDecSec - decD * 3600 - decM * 60
  return {
    raH: String(raH),
    raM: String(raM),
    raS: String(raS),
    decSign: sign,
    decD: String(decD),
    decM: String(decM),
    decS: String(decS),
  }
}

function parseSexagesimalParts(
  parts: SexagesimalParts,
  fallback: { raHours: number; decDeg: number },
): { raHours: number; decDeg: number } {
  const h = Number.parseInt(parts.raH, 10)
  const m = Number.parseInt(parts.raM, 10)
  const s = Number.parseInt(parts.raS, 10)
  const dd = Number.parseInt(parts.decD, 10)
  const dm = Number.parseInt(parts.decM, 10)
  const ds = Number.parseInt(parts.decS, 10)
  if (
    ![h, m, s, dd, dm, ds].every((n) => Number.isFinite(n)) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59 ||
    s < 0 ||
    s > 59 ||
    dd < 0 ||
    dd > 90 ||
    dm < 0 ||
    dm > 59 ||
    ds < 0 ||
    ds > 59
  ) {
    return fallback
  }
  const raHours = h + m / 60 + s / 3600
  let decDeg = dd + dm / 60 + ds / 3600
  if (parts.decSign === '-') decDeg = -decDeg
  if (Math.abs(decDeg) > 90) return fallback
  return { raHours, decDeg }
}

function PillNumberInput({
  label,
  suffix,
  value,
  onCommit,
  parse,
}: {
  label: string
  suffix?: string
  value: number
  onCommit: (v: number) => void
  parse: (raw: string, fallback: number) => number
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    onCommit(parse(draft, value))
    setDraft(String(parse(draft, value)))
  }

  return (
    <label className={`flex ${MOSAIC_PILL} justify-between gap-1`}>
      <span className="min-w-0 shrink truncate text-sm font-medium text-white">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className={numInputClass}
      />
      {suffix ? <span className="shrink-0 text-sm font-medium text-white">{suffix}</span> : null}
    </label>
  )
}

function PanelCoordInputs({
  raHours,
  decDeg,
  onCommit,
}: {
  raHours: number
  decDeg: number
  onCommit: (raHours: number, decDeg: number) => void
}) {
  const [parts, setParts] = useState(() => sexagesimalFromRadec(raHours, decDeg))

  useEffect(() => {
    setParts(sexagesimalFromRadec(raHours, decDeg))
  }, [raHours, decDeg])

  const commit = () => {
    const next = parseSexagesimalParts(parts, { raHours, decDeg })
    setParts(sexagesimalFromRadec(next.raHours, next.decDeg))
    if (next.raHours === raHours && next.decDeg === decDeg) return
    onCommit(next.raHours, next.decDeg)
  }

  const setPart = <K extends keyof SexagesimalParts>(key: K, value: SexagesimalParts[K]) => {
    setParts((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      <div className={`flex ${MOSAIC_PILL} gap-1`} role="group" aria-label="Panel right ascension">
        <span className="shrink-0 text-sm font-medium text-white">RA</span>
        <input
          type="text"
          inputMode="numeric"
          value={parts.raH}
          onChange={(e) => setPart('raH', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="RA hours"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">h</span>
        <input
          type="text"
          inputMode="numeric"
          value={parts.raM}
          onChange={(e) => setPart('raM', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="RA minutes"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">m</span>
        <input
          type="text"
          inputMode="numeric"
          value={parts.raS}
          onChange={(e) => setPart('raS', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="RA seconds"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">s</span>
      </div>
      <div className={`flex ${MOSAIC_PILL} gap-1`} role="group" aria-label="Panel declination">
        <span className="shrink-0 text-sm font-medium text-white">Dec</span>
        <select
          value={parts.decSign}
          onChange={(e) => {
            const sign = e.target.value === '-' ? '-' : '+'
            const next = { ...parts, decSign: sign as '+' | '-' }
            setParts(next)
            const parsed = parseSexagesimalParts(next, { raHours, decDeg })
            if (parsed.raHours !== raHours || parsed.decDeg !== decDeg) {
              onCommit(parsed.raHours, parsed.decDeg)
            }
          }}
          aria-label="Dec sign"
          className="w-7 cursor-pointer appearance-none border-0 bg-transparent py-0 text-center text-sm font-medium text-white outline-none"
        >
          <option value="+" className="bg-neutral-900 text-white">
            +
          </option>
          <option value="-" className="bg-neutral-900 text-white">
            −
          </option>
        </select>
        <input
          type="text"
          inputMode="numeric"
          value={parts.decD}
          onChange={(e) => setPart('decD', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Dec degrees"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">°</span>
        <input
          type="text"
          inputMode="numeric"
          value={parts.decM}
          onChange={(e) => setPart('decM', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Dec minutes"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">′</span>
        <input
          type="text"
          inputMode="numeric"
          value={parts.decS}
          onChange={(e) => setPart('decS', e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Dec seconds"
          className={partInputClass}
        />
        <span className="shrink-0 text-xs text-white/60">″</span>
      </div>
    </>
  )
}

type ToolbarProps = {
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

export function PlanFramingToolbar({
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
}: ToolbarProps) {
  if (!hasEquipment) {
    return (
      <div className={`${MOSAIC_PILL} text-white/70`}>
        Configure equipment in Account (admin)
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${MOSAIC_PILL_H}`}>
      <PlanGlassSegmentSwitch
        options={[
          { value: 'grid' as const, label: 'Grid' },
          { value: 'custom' as const, label: 'Custom' },
        ]}
        value={customMosaic ? 'custom' : 'grid'}
        onChange={(v) => onCustomMosaic(v === 'custom')}
        ariaLabel="Mosaic layout mode"
        className={MOSAIC_PILL_H}
      />

      {customMosaic ? (
        <>
          <button type="button" onClick={onAddPanel} className={MOSAIC_PILL}>
            Add Panel
          </button>
          <label className={`${MOSAIC_PILL} cursor-pointer gap-2`}>
            <span className="shrink-0 text-sm font-medium text-white">Panel</span>
            <select
              value={deletePanelId}
              onChange={(e) => onDeletePanelIdChange(Number.parseInt(e.target.value, 10))}
              className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-0 pl-0 pr-6 text-sm font-medium text-white outline-none"
              aria-label="Selected panel"
            >
              {customPanels.map((p) => (
                <option key={p.id} value={p.id} className="bg-neutral-900 text-white">
                  {p.id}
                </option>
              ))}
            </select>
          </label>
          {selectedPanelCoords ? (
            <PanelCoordInputs
              raHours={selectedPanelCoords.raHours}
              decDeg={selectedPanelCoords.decDeg}
              onCommit={onSelectedPanelCoords}
            />
          ) : null}
          <button
            type="button"
            onClick={onDeletePanel}
            disabled={panelCount <= 1}
            className={`${MOSAIC_PILL} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Delete Panel
          </button>
          {panelCount > 0 ? (
            <span className={`${MOSAIC_PILL} text-emerald-300`}>{panelCount} panels</span>
          ) : (
            <span className={`${MOSAIC_PILL} invisible pointer-events-none`} aria-hidden>
              &nbsp;
            </span>
          )}
        </>
      ) : (
        <>
          <PillNumberInput
            label="Horizontal"
            value={horizontalPanels}
            onCommit={onHorizontalPanels}
            parse={parsePanel}
          />
          <PillNumberInput
            label="Horizontal overlap"
            suffix="%"
            value={horizontalOverlapPercent}
            onCommit={onHorizontalOverlapPercent}
            parse={parseOverlap}
          />
          <PillNumberInput
            label="Vertical"
            value={verticalPanels}
            onCommit={onVerticalPanels}
            parse={parsePanel}
          />
          <PillNumberInput
            label="Vertical overlap"
            suffix="%"
            value={verticalOverlapPercent}
            onCommit={onVerticalOverlapPercent}
            parse={parseOverlap}
          />
          {isMosaic ? (
            <span className={`${MOSAIC_PILL} text-emerald-300`}>{panelCount} panels</span>
          ) : (
            <span className={`${MOSAIC_PILL} invisible pointer-events-none`} aria-hidden>
              &nbsp;
            </span>
          )}
        </>
      )}
    </div>
  )
}

const FRAME_BORDER_CLASS = 'border-yellow-400/90'

type OverlayProps = {
  panels: MosaicPanel[]
  overlayRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
  showSingle: boolean
  singleRef: React.Ref<HTMLDivElement>
  /** Custom mode: per-panel drag + gray hover. */
  panelInteractive: boolean
  /** Grid + Lock: drag any panel to move the whole mosaic together. */
  panelGroupDraggable?: boolean
  /** Non-custom single frame: boresight drag without hover. */
  singleDraggable: boolean
  onSinglePointerDown?: (e: React.PointerEvent) => void
  onSinglePointerMove?: (e: React.PointerEvent) => void
  onSinglePointerUp?: (e: React.PointerEvent) => void
  onGroupPointerDown?: (e: React.PointerEvent) => void
  onGroupPointerMove?: (e: React.PointerEvent) => void
  onGroupPointerUp?: (e: React.PointerEvent) => void
  onPanelPointerDown?: (panelId: number, e: React.PointerEvent) => void
  onPanelPointerMove?: (e: React.PointerEvent) => void
  onPanelPointerUp?: (e: React.PointerEvent) => void
}

const frameSurfaceClass = (interactive: boolean, colorClass: string) =>
  `absolute left-1/2 top-1/2 z-[6] box-border border-2 ${colorClass} transition-colors duration-150 ` +
  (interactive
    ? 'cursor-grab bg-white/0 hover:bg-white/20 active:cursor-grabbing active:bg-white/25'
    : 'pointer-events-none bg-transparent')

export function PlanFrameOverlays({
  panels,
  overlayRefs,
  showSingle,
  singleRef,
  panelInteractive,
  panelGroupDraggable = false,
  singleDraggable,
  onSinglePointerDown,
  onSinglePointerMove,
  onSinglePointerUp,
  onGroupPointerDown,
  onGroupPointerMove,
  onGroupPointerUp,
  onPanelPointerDown,
  onPanelPointerMove,
  onPanelPointerUp,
}: OverlayProps) {
  const singlePointerProps = singleDraggable
    ? {
        onPointerDown: onSinglePointerDown,
        onPointerMove: onSinglePointerMove,
        onPointerUp: onSinglePointerUp,
        onPointerCancel: onSinglePointerUp,
      }
    : {}

  const customPanelPointerProps = panelInteractive
    ? {
        onPointerMove: onPanelPointerMove,
        onPointerUp: onPanelPointerUp,
        onPointerCancel: onPanelPointerUp,
      }
    : {}

  const groupPanelPointerProps = panelGroupDraggable
    ? {
        onPointerDown: onGroupPointerDown,
        onPointerMove: onGroupPointerMove,
        onPointerUp: onGroupPointerUp,
        onPointerCancel: onGroupPointerUp,
      }
    : {}

  if (showSingle) {
    return (
      <div
        ref={singleRef}
        aria-hidden
        className={
          frameSurfaceClass(false, FRAME_BORDER_CLASS) +
          (singleDraggable ? ' cursor-grab active:cursor-grabbing' : '')
        }
        style={{
          transform: 'translate(-50%, -50%) rotate(0deg)',
          transformOrigin: 'center center',
          width: '1px',
          height: '1px',
          pointerEvents: singleDraggable ? 'auto' : 'none',
        }}
        {...singlePointerProps}
      />
    )
  }

  return (
    <>
      {panels.map((p) => {
        const interactive = panelInteractive || panelGroupDraggable
        return (
        <div
          key={p.id}
          ref={(el) => {
            if (el) overlayRefs.current.set(p.id, el)
            else overlayRefs.current.delete(p.id)
          }}
          aria-hidden
          className={frameSurfaceClass(interactive, FRAME_BORDER_CLASS)}
          style={{
            transform: 'translate(-50%, -50%)',
            transformOrigin: 'center center',
            width: '1px',
            height: '1px',
            pointerEvents: interactive ? 'auto' : 'none',
          }}
          {...(panelInteractive ? customPanelPointerProps : groupPanelPointerProps)}
          onPointerDown={
            panelInteractive && onPanelPointerDown
              ? (e) => onPanelPointerDown(p.id, e)
              : panelGroupDraggable
                ? onGroupPointerDown
                : undefined
          }
        >
          <span
            className="pointer-events-none absolute -top-5 left-0 text-[10px] font-bold text-white drop-shadow"
            style={{ transform: 'rotate(calc(-1 * var(--panel-rot, 0deg)))', transformOrigin: 'left center' }}
          >
            {p.id}
          </span>
        </div>
        )
      })}
    </>
  )
}
