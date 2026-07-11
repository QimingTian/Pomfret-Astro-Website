'use client'

import { useMemo } from 'react'

import {
  AUTO_TUNING_TARGET_RGB,
  CHART_H,
  CHART_PAD_L,
  CHART_W,
  clamp,
  expCorrectionAxisScale,
  expDeltaSec,
  formatMeanTick,
  formatSec,
  formatSecTick,
  polylinePoints,
  useChartSlots,
  yMap,
  type NormalizedSample,
} from '@/lib/auto-tuning-chart-utils'
import type { AutoTuningSample } from '@/lib/auto-tuning-history'

import {
  CHART_LEGEND_CLASS,
  EXPOSURE_RIGHT_AXIS,
  LeftAxisGrid,
  RightAxisGrid,
} from './auto-tuning-chart-axes'

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
  const expSec = expDeltaSec(s.expDeltaUs)
  const photoSec = expDeltaSec(s.photoExposureUs)
  return `${new Date(s.frameIso).toLocaleString()}
exp: ${s.expAction} (Δ ${formatSec(expSec)}, photo ${formatSec(photoSec)})
mean error ${s.expError.toFixed(1)} (target ${AUTO_TUNING_TARGET_RGB})
mean RGB ${s.meanR.toFixed(1)}/${s.meanG.toFixed(1)}/${s.meanB.toFixed(1)}`
}

export function AutoExposureTuningChart({ samples, loading, kvError }: Props) {
  const { slots, step, normalized } = useChartSlots(samples)
  // Scale left axis from points actually drawn on this chart (same window as bars/line).
  const leftAxis = useMemo(() => expCorrectionAxisScale(normalized), [normalized])

  const expErrors = slots.map((s) =>
    s
      ? clamp(s.expError, EXPOSURE_RIGHT_AXIS.min, EXPOSURE_RIGHT_AXIS.max)
      : null,
  )

  const bars = slots.map((s, i) => {
    if (!s) return null
    const x = CHART_PAD_L + i * step
    const hold = s.expAction === 'hold' || s.expDeltaUs === 0
    const expSec = clamp(expDeltaSec(s.expDeltaUs), leftAxis.min, leftAxis.max)
    return (
      <g key={s.frameIso}>
        <title>{sampleTitle(s)}</title>
        <ValueBar
          x={x - 2}
          value={hold ? 0 : expSec}
          width={5}
          hold={hold}
          min={leftAxis.min}
          max={leftAxis.max}
          fill={hold ? 'rgba(148,163,184,0.55)' : 'rgba(96,165,250,0.9)'}
        />
      </g>
    )
  })

  const lineExp = polylinePoints(
    expErrors,
    step,
    EXPOSURE_RIGHT_AXIS.min,
    EXPOSURE_RIGHT_AXIS.max,
  )

  return (
    <div className="w-full space-y-1 pt-2">
      {loading ? <span className="text-xs text-gray-500">Updating…</span> : null}
      {kvError ? <p className="text-xs text-amber-400">{kvError}</p> : null}
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="block h-[150px] w-full bg-transparent font-sans tabular-nums"
        role="img"
        aria-label="Auto exposure tuning history"
      >
        <LeftAxisGrid
          ticks={[...leftAxis.ticks]}
          min={leftAxis.min}
          max={leftAxis.max}
          formatTick={formatSecTick}
          labelFill="rgba(96,165,250,0.9)"
        />
        <RightAxisGrid scale={EXPOSURE_RIGHT_AXIS} formatTick={formatMeanTick} />
        {bars}
        {normalized.length > 0 && lineExp ? (
          <polyline
            fill="none"
            stroke="rgba(250,204,21,0.85)"
            strokeWidth={0.65}
            points={lineExp}
          />
        ) : null}
      </svg>
      <div className={CHART_LEGEND_CLASS}>
        <span>
          <span className="inline-block h-2 w-1 rounded-sm bg-blue-400/90 align-middle" /> Exposure
          Correction (Left)
        </span>
        <span>
          <span className="inline-block h-0.5 w-3 bg-yellow-400 align-middle" /> Mean Error (Right)
        </span>
      </div>
    </div>
  )
}
