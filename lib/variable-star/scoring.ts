import type { VariableStarFilterId } from '@/lib/variable-star/filters'
import { inferShortlistBuckets } from '@/lib/variable-star/filters'
import { famousNameScoreBonus } from '@/lib/variable-star/famous'
import type { ObservabilityMetrics } from '@/lib/variable-star/observability'
import { POMFRET_FAINTEST_MAG_LIMIT } from '@/lib/variable-star/vsx'
import type { VsxCandidate } from '@/lib/variable-star/vsx'

export type ScoredCandidate = {
  candidate: VsxCandidate
  raHours: number
  metrics: ObservabilityMetrics
  score: number
  buckets: VariableStarFilterId[]
}

export function scoreCandidate(
  candidate: VsxCandidate,
  metrics: ObservabilityMetrics,
  observabilityScore: number
): number {
  const faintest = candidate.faintestMag ?? POMFRET_FAINTEST_MAG_LIMIT
  const detectability = Math.max(0, (POMFRET_FAINTEST_MAG_LIMIT - faintest) / 4)
  const amp = candidate.amplitude ?? estimateAmplitude(candidate)
  const amplitudeScore = amp == null ? 0.5 : Math.min(1, amp / 2)
  const classicalBonus = candidate.isClassicalName ? 1.5 : 0
  const famousBonus = famousNameScoreBonus(candidate.name)
  const sessionFit = sessionFitScore(candidate)
  return (
    observabilityScore * 0.35 +
    detectability * 4 * 0.3 +
    amplitudeScore * 3 * 0.2 +
    sessionFit * 2 * 0.1 +
    classicalBonus * 0.05 +
    famousBonus
  )
}

function estimateAmplitude(candidate: VsxCandidate): number | null {
  if (candidate.amplitude != null) return candidate.amplitude
  if (candidate.maxMag != null && candidate.minMag != null) {
    return Math.abs(candidate.minMag - candidate.maxMag)
  }
  return null
}

function sessionFitScore(candidate: VsxCandidate): number {
  const p = candidate.periodDays
  if (p == null) return 0.4
  if (p < 1) return p < 0.05 ? 0.6 : Math.min(1, 3 / p)
  if (p < 100) return 0.7
  return candidate.faintestMag != null && candidate.faintestMag <= 12 ? 0.9 : 0.5
}

export function buildScoredCandidate(
  candidate: VsxCandidate,
  metrics: ObservabilityMetrics,
  observabilityScoreValue: number
): ScoredCandidate {
  const raHours = candidate.raDeg / 15
  const stub = {
    name: candidate.name,
    raHours,
    decDeg: candidate.decDeg,
    varType: candidate.varType,
    periodDays: candidate.periodDays,
    minMag: candidate.minMag,
    maxMag: candidate.maxMag,
    highPriority: false,
    categories: [] as string[],
  }
  const buckets = inferShortlistBuckets(stub).filter(
    (b) => b !== 'high_priority'
  ) as VariableStarFilterId[]
  const score = scoreCandidate(candidate, metrics, observabilityScoreValue)
  return { candidate, raHours, metrics, score, buckets }
}

export const SHORTLIST_BUCKET_IDS: VariableStarFilterId[] = [
  'short_period',
  'mid_period',
  'long_period',
  'type_na',
  'type_lc',
  'type_m',
  'type_src',
  'type_ea',
  'type_cv',
  'type_rr',
  'type_cep',
]

export const SHORTLIST_PER_BUCKET = 50
export const SHORTLIST_HIGH_PRIORITY_COUNT = 50
export const SHORTLIST_MAX_PER_RA_HOUR = 5
