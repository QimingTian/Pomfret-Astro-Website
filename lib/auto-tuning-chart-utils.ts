import {
  AUTO_TUNING_HISTORY_MAX,
  AUTO_TUNING_TARGET_RGB,
  AUTO_TUNING_WB_DEADBAND,
  AUTO_WB_TARGET_B,
  AUTO_WB_TARGET_R,
  type AutoTuningSample,
} from '@/lib/auto-tuning-history'

export const CHART_W = 1000
export const CHART_H = 150
export const CHART_PAD_L = 44
export const CHART_PAD_R = 44
export const CHART_PAD_T = 8
export const CHART_PAD_B = 20
export const CHART_PLOT_W = CHART_W - CHART_PAD_L - CHART_PAD_R
export const CHART_PLOT_H = CHART_H - CHART_PAD_T - CHART_PAD_B

export type NormalizedSample = AutoTuningSample & {
  expError: number
  rDiff: number
  bDiff: number
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function saneMean(v: number): number {
  if (!Number.isFinite(v) || v < 0 || v > 255) return 0
  return v
}

export function normalizeSample(s: AutoTuningSample): NormalizedSample {
  const meanR = saneMean(s.meanR)
  const meanG = saneMean(s.meanG)
  const meanB = saneMean(s.meanB)
  const meanRgb =
    saneMean(s.meanRgb) > 0 ? saneMean(s.meanRgb) : (meanR + meanG + meanB) / 3
  const wbR = Number.isFinite(s.wbR) ? s.wbR : AUTO_WB_TARGET_R
  const wbB = Number.isFinite(s.wbB) ? s.wbB : AUTO_WB_TARGET_B
  return {
    ...s,
    meanR,
    meanG,
    meanB,
    meanRgb,
    expError: meanRgb - AUTO_TUNING_TARGET_RGB,
    rDiff: meanR - meanG,
    bDiff: meanB - meanG,
    wbR,
    wbB,
    expDeltaUs: Number.isFinite(s.expDeltaUs) ? s.expDeltaUs : 0,
    photoExposureUs: Number.isFinite(s.photoExposureUs) ? s.photoExposureUs : 0,
    wbRDelta: Number.isFinite(s.wbRDelta) ? s.wbRDelta : 0,
    wbBDelta: Number.isFinite(s.wbBDelta) ? s.wbBDelta : 0,
  }
}

export function useChartSlots(samples: AutoTuningSample[]) {
  const normalized = samples.map(normalizeSample)
  const pad = Math.max(0, AUTO_TUNING_HISTORY_MAX - normalized.length)
  const slots = [...Array(pad).fill(null), ...normalized] as (NormalizedSample | null)[]
  const step = AUTO_TUNING_HISTORY_MAX <= 1 ? 0 : CHART_PLOT_W / (AUTO_TUNING_HISTORY_MAX - 1)
  return { slots, step, normalized }
}

export function yMap(v: number, min: number, max: number): number {
  if (max <= min) return CHART_PAD_T + CHART_PLOT_H / 2
  const t = (v - min) / (max - min)
  return CHART_PAD_T + (1 - t) * CHART_PLOT_H
}

export function polylinePoints(
  values: (number | null)[],
  step: number,
  min: number,
  max: number,
): string {
  const pts: string[] = []
  values.forEach((v, i) => {
    if (v === null) return
    const x = CHART_PAD_L + i * step
    const y = yMap(v, min, max)
    pts.push(`${x},${y}`)
  })
  return pts.join(' ')
}

export function expDeltaSec(deltaUs: number): number {
  return deltaUs / 1_000_000
}

export function formatSecTick(sec: number): string {
  if (sec === 0) return '0'
  if (Math.abs(sec) >= 10) return `${sec > 0 ? '+' : ''}${sec}s`
  if (Number.isInteger(sec)) return `${sec > 0 ? '+' : ''}${sec}s`
  return `${sec > 0 ? '+' : ''}${sec.toFixed(1)}s`
}

export function formatSec(sec: number): string {
  const a = Math.abs(sec)
  if (a >= 10) return `${sec.toFixed(1)}s`
  if (a >= 1) return `${sec.toFixed(2)}s`
  if (a >= 0.01) return `${sec.toFixed(3)}s`
  if (a === 0) return '0s'
  return `${sec.toExponential(1)}s`
}

export function formatStepTick(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

export function formatMeanTick(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

export function axisTicks(min: number, max: number, step: number): number[] {
  const ticks: number[] = []
  for (let t = min; t <= max + step * 0.01; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return ticks
}

/** Left axis for exposure correction (Δs) from on-screen samples: ±(ceil(max|Δ|)+1), min ±1. */
export function expCorrectionAxisScale(samples: readonly AutoTuningSample[]): {
  min: number
  max: number
  /** Few grid lines only: −limit, −limit/2, 0, +limit/2, +limit */
  ticks: number[]
} {
  let maxAbsSec = 0
  for (const s of samples) {
    const sec = Math.abs(expDeltaSec(s.expDeltaUs ?? 0))
    if (sec > maxAbsSec) maxAbsSec = sec
  }

  const limit = maxAbsSec < 1 ? 1 : Math.ceil(maxAbsSec) + 1

  if (limit <= 1) {
    return { min: -1, max: 1, ticks: [-1, 0, 1] }
  }

  const half = limit / 2
  const ticks = [-limit, -half, 0, half, limit].map((t) => Math.round(t * 1000) / 1000)

  return { min: -limit, max: limit, ticks }
}

export { AUTO_TUNING_WB_DEADBAND, AUTO_TUNING_TARGET_RGB, AUTO_WB_TARGET_R, AUTO_WB_TARGET_B }
