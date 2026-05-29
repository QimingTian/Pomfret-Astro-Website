'use client'

import {
  axisTicks,
  CHART_H,
  CHART_PAD_L,
  CHART_PLOT_W,
  CHART_W,
  clamp,
  formatMeanTick,
  formatStepTick,
  polylinePoints,
  useChartSlots,
  yMap,
  type NormalizedSample,
} from '@/lib/auto-tuning-chart-utils'
import type { AutoTuningSample } from '@/lib/auto-tuning-history'

import {
  CHART_LEGEND_CLASS,
  LeftAxisGrid,
  RightAxisGrid,
  WB_RIGHT_AXIS,
} from './auto-tuning-chart-axes'

const LEFT_MIN = -15
const LEFT_MAX = 15
const LEFT_STEP = 5

type Props = {
  samples: AutoTuningSample[]
  loading?: boolean
  kvError?: string | null
}

function ValueBar({
  x,
  value,
  width,
  fill,
  hold,
  min,
  max,
}: {
  x: number
  value: number
  width: number
  fill: string
  hold?: boolean
  min: number
  max: number
}) {
  const y0 = yMap(0, min, max)
  if (hold || value === 0) {
    const h = 3
    return (
      <rect x={x} y={y0 - h / 2} width={width} height={h} fill={fill} rx={0.5} opacity={0.7} />
    )
  }
  const v = clamp(value, min, max)
  const yVal = yMap(v, min, max)
  const top = Math.min(yVal, y0)
  const h = Math.max(1, Math.abs(yVal - y0))
  return <rect x={x} y={top} width={width} height={h} fill={fill} rx={0.5} />
}

function sampleTitle(s: NormalizedSample) {
  return `${new Date(s.frameIso).toLocaleString()}
wb: ${s.wbAction} (ΔR ${s.wbRDelta}, ΔB ${s.wbBDelta})
mean R−G ${s.rDiff.toFixed(1)}, B−G ${s.bDiff.toFixed(1)}
wb R ${s.wbR}, wb B ${s.wbB}`
}

export function AutoWbTuningChart({ samples, loading, kvError }: Props) {
  const { slots, step, normalized } = useChartSlots(samples)
  const leftTicks = axisTicks(LEFT_MIN, LEFT_MAX, LEFT_STEP)

  const rDiffs = slots.map((s) =>
    s ? clamp(s.rDiff, WB_RIGHT_AXIS.min, WB_RIGHT_AXIS.max) : null,
  )
  const bDiffs = slots.map((s) =>
    s ? clamp(s.bDiff, WB_RIGHT_AXIS.min, WB_RIGHT_AXIS.max) : null,
  )

  const bars = slots.map((s, i) => {
    if (!s) return null
    const x = CHART_PAD_L + i * step
    const rHold = s.wbRDelta === 0
    const bHold = s.wbBDelta === 0
    return (
      <g key={s.frameIso}>
        <title>{sampleTitle(s)}</title>
        <ValueBar
          x={x - 5}
          value={rHold ? 0 : s.wbRDelta}
          width={4}
          hold={rHold}
          min={LEFT_MIN}
          max={LEFT_MAX}
          fill={rHold ? 'rgba(148,163,184,0.55)' : 'rgba(248,113,113,0.9)'}
        />
        <ValueBar
          x={x + 2}
          value={bHold ? 0 : s.wbBDelta}
          width={4}
          hold={bHold}
          min={LEFT_MIN}
          max={LEFT_MAX}
          fill={bHold ? 'rgba(148,163,184,0.45)' : 'rgba(45,212,191,0.9)'}
        />
      </g>
    )
  })

  const lineR = polylinePoints(rDiffs, step, WB_RIGHT_AXIS.min, WB_RIGHT_AXIS.max)
  const lineB = polylinePoints(bDiffs, step, WB_RIGHT_AXIS.min, WB_RIGHT_AXIS.max)

  return (
    <div className="w-full space-y-1 pt-2">
      {loading ? <span className="text-xs text-gray-500">Updating…</span> : null}
      {kvError ? <p className="text-xs text-amber-400">{kvError}</p> : null}
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="block h-[150px] w-full bg-transparent font-sans tabular-nums"
        role="img"
        aria-label="Auto white balance tuning history"
      >
        <LeftAxisGrid
          ticks={leftTicks}
          min={LEFT_MIN}
          max={LEFT_MAX}
          formatTick={formatStepTick}
          labelFill="rgba(248,113,113,0.9)"
        />
        <RightAxisGrid scale={WB_RIGHT_AXIS} formatTick={formatMeanTick} />
        {bars}
        {normalized.length > 0 ? (
          <>
            {lineR ? (
              <polyline
                fill="none"
                stroke="rgba(248,113,113,0.75)"
                strokeWidth={0.65}
                points={lineR}
              />
            ) : null}
            {lineB ? (
              <polyline
                fill="none"
                stroke="rgba(45,212,191,0.75)"
                strokeWidth={0.65}
                points={lineB}
              />
            ) : null}
          </>
        ) : null}
      </svg>
      <div className={CHART_LEGEND_CLASS}>
        <span>
          <span className="inline-block h-2 w-1 rounded-sm bg-red-400/90 align-middle" /> WB R
          Correction (Left)
        </span>
        <span>
          <span className="inline-block h-2 w-1 rounded-sm bg-teal-400/90 align-middle" /> WB B
          Correction (Left)
        </span>
        <span>
          <span className="inline-block h-0.5 w-3 bg-red-400 align-middle" /> Mean R−G (Right)
        </span>
        <span>
          <span className="inline-block h-0.5 w-3 bg-teal-400 align-middle" /> Mean B−G (Right)
        </span>
      </div>
    </div>
  )
}
