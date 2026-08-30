'use client'

import { glassPillMd } from '@/lib/glass-ui'

export type RibbonAstronomyMarker = { id: string; label: string; sec: number; frac: number }

type Props = {
  barRef: React.RefObject<HTMLDivElement>
  ribbonStartSec: number
  ribbonEndSec: number
  ribbonHourStartsSec: number[]
  /** Observatory-local IANA timezone for ribbon labels and hover scrubber. */
  timezone: string
  weatherColorsKnown: boolean
  readySet: Set<number>
  markers: RibbonAstronomyMarker[]
  hoverFrac: number | null
  onHoverFrac: (frac: number | null) => void
  onRibbonClick: (ev: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void
  onReturnToNow: () => void
  stelReady: boolean
}

function formatHoverTimeToMinute(sec: number, timeZone: string): string {
  const d = new Date(sec * 1000)
  const datePart = d.toLocaleDateString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
  })
  const timePart = d.toLocaleTimeString(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return `${datePart} ${timePart}`
}

function formatRibbonAstronomyTime(sec: number, timeZone: string): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function MarkerLabels({
  markers,
  placement,
  timezone,
}: {
  markers: RibbonAstronomyMarker[]
  placement: 'above' | 'below'
  timezone: string
}) {
  return (
    <div
      className={`relative w-full ${placement === 'above' ? 'mb-0.5 min-h-[2.25rem] sm:min-h-[2.5rem]' : 'mt-0.5 min-h-[2.25rem] sm:min-h-[2.5rem]'}`}
    >
      {markers.map((m, i) => {
        const show = placement === 'above' ? i % 2 === 0 : i % 2 === 1
        if (!show) return null
        return (
          <div
            key={`${m.id}-label-${placement}`}
            className={`pointer-events-none absolute inset-x-0 z-[6] h-full ${placement === 'above' ? 'bottom-0' : 'top-0'}`}
            aria-hidden
          >
            <div
              className={`absolute max-w-[5.75rem] -translate-x-1/2 text-center text-[9px] leading-tight text-white/95 sm:max-w-[6.75rem] sm:text-[10px] ${placement === 'above' ? 'bottom-0' : 'top-0'}`}
              style={{ left: `${m.frac * 100}%` }}
            >
              <span className="block text-white/65">{m.label}</span>
              <span className="block font-medium tabular-nums">{formatRibbonAstronomyTime(m.sec, timezone)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PlanRibbon({
  barRef,
  ribbonStartSec,
  ribbonEndSec,
  ribbonHourStartsSec,
  timezone,
  weatherColorsKnown,
  readySet,
  markers,
  hoverFrac,
  onHoverFrac,
  onRibbonClick,
  onReturnToNow,
  stelReady,
}: Props) {
  return (
    <div className="relative w-full">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0">
          <MarkerLabels markers={markers} placement="above" timezone={timezone} />
        </div>

        <div
          className="col-start-1 row-start-2 min-w-0 cursor-default"
          onMouseMove={(e) => {
            const bar = barRef.current
            if (!bar) return
            const rect = bar.getBoundingClientRect()
            onHoverFrac(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
          }}
          onMouseLeave={() => onHoverFrac(null)}
        >
          <div
            ref={barRef}
            role="button"
            tabIndex={0}
            aria-label="Tonight's observing window — click to time-travel"
            onClick={onRibbonClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onRibbonClick(e)
            }}
            className="relative h-10 w-full cursor-pointer rounded-lg bg-black/40"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
              {ribbonHourStartsSec.map((sec) => {
                const frac = (sec - ribbonStartSec) / (ribbonEndSec - ribbonStartSec)
                const width = 3600 / (ribbonEndSec - ribbonStartSec)
                const colorClass = !weatherColorsKnown
                  ? 'bg-white/20'
                  : readySet.has(sec)
                    ? 'bg-emerald-500/50'
                    : 'bg-rose-600/50'
                return (
                  <div
                    key={sec}
                    className={`absolute top-0 bottom-0 ${colorClass}`}
                    style={{ left: `${frac * 100}%`, width: `${width * 100}%` }}
                  />
                )
              })}
              {ribbonHourStartsSec.map((sec) => {
                const frac = (sec - ribbonStartSec) / (ribbonEndSec - ribbonStartSec)
                return (
                  <div
                    key={`tick-${sec}`}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/25"
                    style={{ left: `${frac * 100}%` }}
                  />
                )
              })}
            </div>
            {hoverFrac != null && ribbonEndSec > ribbonStartSec ? (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-[5] w-0.5 bg-white/90"
                style={{ left: `${hoverFrac * 100}%` }}
              />
            ) : null}
            {hoverFrac != null && ribbonEndSec > ribbonStartSec ? (
              <div
                className="pointer-events-none absolute top-full z-[8] mt-1 max-w-[min(100%,14rem)] -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums text-white/95 shadow-sm"
                style={{ left: `${hoverFrac * 100}%` }}
                aria-hidden
              >
                {formatHoverTimeToMinute(ribbonStartSec + hoverFrac * (ribbonEndSec - ribbonStartSec), timezone)}
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onReturnToNow}
          disabled={!stelReady}
          className={`col-start-2 row-start-2 h-10 shrink-0 self-center ${glassPillMd} disabled:opacity-50`}
        >
          Return to now
        </button>

        <div className="col-start-1 row-start-3 min-w-0">
          <MarkerLabels markers={markers} placement="below" timezone={timezone} />
        </div>
      </div>
    </div>
  )
}
