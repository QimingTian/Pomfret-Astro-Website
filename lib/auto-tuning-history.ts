import { kvGetJson, kvSetJson } from '@/lib/kv-rest'

export const AUTO_TUNING_HISTORY_MAX = 30
export const AUTO_TUNING_TARGET_RGB = 45
export const AUTO_TUNING_WB_DEADBAND = 2
export const AUTO_WB_TARGET_R = 50
export const AUTO_WB_TARGET_B = 70

const KV_KEY = 'allsky-auto-tuning-history'

export type AutoTuningSample = {
  /** lastAutoFrameIso from Pi */
  frameIso: string
  recordedAt: string
  meanRgb: number
  meanR: number
  meanG: number
  meanB: number
  /** meanRgb − target center (45) */
  expError: number
  rDiff: number
  bDiff: number
  expAction: string
  wbAction: string
  photoExposureUs: number
  wbR: number
  wbB: number
  expDeltaUs: number
  wbRDelta: number
  wbBDelta: number
}

export type AutoTuningHistoryPayload = {
  samples: AutoTuningSample[]
  max: number
}

export async function getAutoTuningHistory(): Promise<AutoTuningHistoryPayload> {
  const stored = await kvGetJson<AutoTuningSample[]>(KV_KEY)
  const samples = Array.isArray(stored)
    ? stored.map(sanitizeSample).slice(-AUTO_TUNING_HISTORY_MAX)
    : []
  return { samples, max: AUTO_TUNING_HISTORY_MAX }
}

function sanitizeSample(sample: AutoTuningSample): AutoTuningSample {
  const meanR = clampMean(sample.meanR)
  const meanG = clampMean(sample.meanG)
  const meanB = clampMean(sample.meanB)
  const meanRgb =
    clampMean(sample.meanRgb) > 0 ? clampMean(sample.meanRgb) : (meanR + meanG + meanB) / 3
  return {
    ...sample,
    meanR,
    meanG,
    meanB,
    meanRgb,
    expError: meanRgb - AUTO_TUNING_TARGET_RGB,
    rDiff: meanR - meanG,
    bDiff: meanB - meanG,
    expDeltaUs: Number.isFinite(sample.expDeltaUs) ? sample.expDeltaUs : 0,
    photoExposureUs: Number.isFinite(sample.photoExposureUs) ? sample.photoExposureUs : 0,
  }
}

function clampMean(v: number): number {
  if (!Number.isFinite(v) || v < 0 || v > 255) return 0
  return v
}

export async function appendAutoTuningSample(
  sample: AutoTuningSample,
): Promise<AutoTuningHistoryPayload> {
  const clean = sanitizeSample(sample)
  const stored = await kvGetJson<AutoTuningSample[]>(KV_KEY)
  const prev = Array.isArray(stored) ? stored.map(sanitizeSample) : []
  const last = prev[prev.length - 1]
  if (last?.frameIso === clean.frameIso) {
    return { samples: prev.slice(-AUTO_TUNING_HISTORY_MAX), max: AUTO_TUNING_HISTORY_MAX }
  }
  const next = [...prev, clean].slice(-AUTO_TUNING_HISTORY_MAX)
  await kvSetJson(KV_KEY, next)
  return { samples: next, max: AUTO_TUNING_HISTORY_MAX }
}
