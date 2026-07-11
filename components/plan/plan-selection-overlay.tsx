'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { glassSurface } from '@/lib/glass-ui'

export type SkyCoord = { raHours: number; decDeg: number }

export type LiveSkyInfo =
  | { kind: 'view'; center: SkyCoord | null }
  | { kind: 'frame'; center: SkyCoord | null }
  | {
      kind: 'mosaic'
      panels: Array<{ id: number; name: string; center: SkyCoord }>
    }

type SelectionRow = { label: string; value: string }

type Props = {
  selection: { id: string; rows: SelectionRow[] } | null
  live: LiveSkyInfo
}

function formatRaHours(raHours: number): string {
  const wrapped = ((raHours % 24) + 24) % 24
  const h = Math.floor(wrapped)
  const m = Math.floor((wrapped - h) * 60)
  const s = ((wrapped - h) * 60 - m) * 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`
}

function formatDecDeg(decDeg: number): string {
  const sign = decDeg >= 0 ? '+' : '−'
  const abs = Math.abs(decDeg)
  const d = Math.floor(abs)
  const m = Math.floor((abs - d) * 60)
  const s = ((abs - d) * 60 - m) * 60
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″`
}

function formatSky(sky: SkyCoord | null): string {
  if (!sky || !Number.isFinite(sky.raHours) || !Number.isFinite(sky.decDeg)) return '—'
  return `${formatRaHours(sky.raHours)}  ${formatDecDeg(sky.decDeg)}`
}

function CoordBlock({ label, sky }: { label: string; sky: SkyCoord | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-0.5 font-mono text-xs tabular-nums leading-snug text-white/95">{formatSky(sky)}</div>
    </div>
  )
}

function SmoothGlassBox({
  contentKey,
  children,
}: {
  contentKey: string
  children: ReactNode
}) {
  const measureRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<{ w: number; h: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [animating, setAnimating] = useState(false)
  const [maxH, setMaxH] = useState(420)

  useLayoutEffect(() => {
    const updateMax = () => setMaxH(Math.round(Math.min(window.innerHeight * 0.55, 420)))
    updateMax()
    window.addEventListener('resize', updateMax)
    return () => window.removeEventListener('resize', updateMax)
  }, [])

  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return

    const apply = () => {
      const next = { w: Math.ceil(el.scrollWidth), h: Math.ceil(el.scrollHeight) }
      const prev = sizeRef.current
      if (prev && prev.w === next.w && prev.h === next.h) return
      if (prev) setAnimating(true)
      sizeRef.current = next
      setSize(next)
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [contentKey])

  const cappedH = size ? Math.min(size.h, maxH) : undefined
  const scrollable = size != null && size.h > maxH

  return (
    <div
      className={`glass-pill ${glassSurface} pointer-events-auto ${scrollable ? 'overflow-y-auto' : 'overflow-hidden'}`}
      style={{
        borderRadius: '1rem',
        width: size ? `${size.w}px` : undefined,
        height: cappedH != null ? `${cappedH}px` : undefined,
        maxHeight: `${maxH}px`,
        transition: animating
          ? 'width 320ms var(--lg-bezier, cubic-bezier(0.32, 0.72, 0, 1)), height 320ms var(--lg-bezier, cubic-bezier(0.32, 0.72, 0, 1))'
          : undefined,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'height' || e.propertyName === 'width') setAnimating(false)
      }}
      aria-live="polite"
    >
      <div ref={measureRef} className="w-max max-w-[min(calc(100vw-1.5rem),30rem)] px-3.5 py-2.5">
        {children}
      </div>
    </div>
  )
}

export function PlanSelectionOverlay({ selection, live }: Props) {
  const hasSelection = Boolean(selection?.id)
  const compactRows =
    selection?.rows.filter((r) => !r.label.includes('JSON')).slice(0, 8) ?? []

  const contentKey = hasSelection
    ? `sel:${selection!.id}:${compactRows.length}`
    : live.kind === 'mosaic'
      ? `mosaic:${live.panels.length}`
      : live.kind

  return (
    <SmoothGlassBox contentKey={contentKey}>
      {hasSelection && selection ? (
        <div aria-label="Selected object">
          <p className="break-words text-sm font-medium leading-snug text-white">{selection.id || '—'}</p>
          {compactRows.length > 0 ? (
            <dl className="mt-2 space-y-1">
              {compactRows.map((row) => (
                <div key={row.label} className="flex gap-2 text-xs leading-snug">
                  <dt className="shrink-0 text-white/55">{row.label}</dt>
                  <dd className="min-w-0 break-words font-mono tabular-nums text-white/90">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : live.kind === 'mosaic' ? (
        <div className="space-y-2" aria-label="Mosaic panel coordinates">
          {live.panels.length === 0 ? (
            <CoordBlock label="Mosaic" sky={null} />
          ) : (
            live.panels.map((p) => (
              <CoordBlock key={p.id} label={p.name || `Panel ${p.id}`} sky={p.center} />
            ))
          )}
        </div>
      ) : (
        <CoordBlock
          label={live.kind === 'frame' ? 'Frame center' : 'View center'}
          sky={live.center}
        />
      )}
    </SmoothGlassBox>
  )
}
