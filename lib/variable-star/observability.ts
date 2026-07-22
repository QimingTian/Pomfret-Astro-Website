import { altitudeAllowedCoverageMs, currentAltitudeDeg, TONIGHT_OBSERVABLE_MIN_COVERAGE_MS } from '@/lib/target-altitude'
import { getTonightAstronomicalNightWindow } from '@/lib/sunrise-window'

export const SHORTLIST_LOOKAHEAD_NIGHTS = 14

export type ObservabilityMetrics = {
  /** Best single-night altitude coverage (ms) during astronomical night. */
  bestNightCoverageMs: number
  /** Sum of nightly coverage across the lookahead window. */
  totalCoverageMs: number
  /** Max altitude at window midpoint (rough proxy for image quality). */
  peakAltitudeDeg: number
}

export function observabilityMetricsForWindow(
  raHours: number,
  decDeg: number,
  startUtc: Date,
  nights = SHORTLIST_LOOKAHEAD_NIGHTS
): ObservabilityMetrics {
  let bestNightCoverageMs = 0
  let totalCoverageMs = 0
  const mid = new Date(startUtc.getTime() + (nights * 86400000) / 2)
  const peakAltitudeDeg = currentAltitudeDeg(raHours, decDeg, mid)

  for (let i = 0; i < nights; i += 1) {
    const dayAnchor = new Date(
      Date.UTC(
        startUtc.getUTCFullYear(),
        startUtc.getUTCMonth(),
        startUtc.getUTCDate() + i,
        12,
        0,
        0
      )
    )
    const { astronomicalDuskUtc, astronomicalDawnUtc } = getTonightAstronomicalNightWindow(dayAnchor)
    const cov = altitudeAllowedCoverageMs(
      raHours,
      decDeg,
      astronomicalDuskUtc.getTime(),
      astronomicalDawnUtc.getTime()
    )
    bestNightCoverageMs = Math.max(bestNightCoverageMs, cov)
    totalCoverageMs += cov
  }

  return { bestNightCoverageMs, totalCoverageMs, peakAltitudeDeg }
}

/** Hard gate: must be observable at >=30° for at least one scheduling window in the lookahead. */
export function passesObservabilityGate(metrics: ObservabilityMetrics): boolean {
  return metrics.bestNightCoverageMs >= TONIGHT_OBSERVABLE_MIN_COVERAGE_MS
}

export function observabilityScore(metrics: ObservabilityMetrics): number {
  const nightHours = metrics.bestNightCoverageMs / 3600000
  const totalHours = metrics.totalCoverageMs / 3600000
  const altBonus = Math.min(1, Math.max(0, (metrics.peakAltitudeDeg - 30) / 40))
  return nightHours * 2 + totalHours * 0.25 + altBonus * 3
}
