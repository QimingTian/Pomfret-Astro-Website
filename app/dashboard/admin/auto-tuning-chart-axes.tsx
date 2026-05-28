'use client'

import {
  CHART_PAD_L,
  CHART_PLOT_W,
  yMap,
} from '@/lib/auto-tuning-chart-utils'

/** Match app/globals.css body font stack */
export const CHART_FONT_FAMILY =
  "'SF Pro Text', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"

export type RightAxisScale = {
  min: number
  max: number
  gridTicks: readonly number[]
  labelTicks: readonly number[]
}

/** Exposure chart: mean error on right */
export const EXPOSURE_RIGHT_AXIS: RightAxisScale = {
  min: -24,
  max: 24,
  gridTicks: [-24, -12, 0, 12, 24],
  labelTicks: [-24, -12, 12, 24],
}

/** WB chart: wb vs target on right */
export const WB_RIGHT_AXIS: RightAxisScale = {
  min: -21,
  max: 21,
  gridTicks: [-21, -14, -7, 0, 7, 14, 21],
  labelTicks: [-21, -14, -7, 0, 7, 14, 21],
}

const LABEL_PROPS = {
  fontFamily: CHART_FONT_FAMILY,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums' as const,
}

function gridStroke(tick: number): string {
  return tick === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)'
}

type LeftAxisProps = {
  ticks: number[]
  min: number
  max: number
  formatTick: (n: number) => string
  labelFill?: string
}

export function LeftAxisGrid({
  ticks,
  min,
  max,
  formatTick,
  labelFill = 'rgba(156,163,175,0.85)',
}: LeftAxisProps) {
  return (
    <>
      {ticks.map((tick) => {
        const y = yMap(tick, min, max)
        return (
          <g key={`L-${tick}`}>
            <line
              x1={CHART_PAD_L}
              y1={y}
              x2={CHART_PAD_L + CHART_PLOT_W}
              y2={y}
              stroke={gridStroke(tick)}
            />
            <text
              x={CHART_PAD_L - 6}
              y={y + 3.5}
              textAnchor="end"
              fill={labelFill}
              {...LABEL_PROPS}
            >
              {formatTick(tick)}
            </text>
          </g>
        )
      })}
    </>
  )
}

type RightAxisProps = {
  scale: RightAxisScale
  formatTick: (n: number) => string
  labelFill?: string
}

export function RightAxisGrid({
  scale,
  formatTick,
  labelFill = 'rgba(156,163,175,0.85)',
}: RightAxisProps) {
  const labelSet = new Set<number>(scale.labelTicks)
  return (
    <>
      {scale.gridTicks.map((tick) => {
        const y = yMap(tick, scale.min, scale.max)
        return (
          <g key={`R-${tick}`}>
            <line
              x1={CHART_PAD_L}
              y1={y}
              x2={CHART_PAD_L + CHART_PLOT_W}
              y2={y}
              stroke={gridStroke(tick)}
            />
            {labelSet.has(tick) ? (
              <text
                x={CHART_PAD_L + CHART_PLOT_W + 6}
                y={y + 3.5}
                textAnchor="start"
                fill={labelFill}
                {...LABEL_PROPS}
              >
                {formatTick(tick)}
              </text>
            ) : null}
          </g>
        )
      })}
    </>
  )
}

export const CHART_LEGEND_CLASS =
  'flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-[10px] tabular-nums text-gray-400'
