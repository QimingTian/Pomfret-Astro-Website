/** Peak ADU fraction for ExoPlanets CalculateExposureTime (full well = 1). */
export const VARIABLE_STAR_TARGET_ADU_MIN = 0.3
export const VARIABLE_STAR_TARGET_ADU_DEFAULT = 0.4
export const VARIABLE_STAR_TARGET_ADU_SMALL = 0.5
export const VARIABLE_STAR_TARGET_ADU_MEDIUM = 0.4
export const VARIABLE_STAR_TARGET_ADU_LARGE = VARIABLE_STAR_TARGET_ADU_MIN

/** VSX-style: maxMag is brighter (smaller number), minMag is fainter. */
export function variableStarAmplitudeMag(
  minMag: number | null | undefined,
  maxMag: number | null | undefined
): number | null {
  if (
    typeof minMag !== 'number' ||
    typeof maxMag !== 'number' ||
    !Number.isFinite(minMag) ||
    !Number.isFinite(maxMag)
  ) {
    return null
  }
  const amp = Math.abs(minMag - maxMag)
  return amp > 0 ? amp : null
}

/**
 * One-shot calc exposure: size TargetADU by amplitude so a faint-phase trial
 * is less likely to saturate at maximum. Floor at 0.3.
 *
 * - amp &lt; 0.4 mag → 0.50
 * - 0.4–0.8 → 0.40
 * - ≥ 0.8 (or unknown) → 0.30 / 0.40 default
 */
export function variableStarTargetAduFromAmplitude(amplitudeMag: number | null | undefined): number {
  if (typeof amplitudeMag !== 'number' || !Number.isFinite(amplitudeMag) || amplitudeMag <= 0) {
    return VARIABLE_STAR_TARGET_ADU_DEFAULT
  }
  if (amplitudeMag < 0.4) return VARIABLE_STAR_TARGET_ADU_SMALL
  if (amplitudeMag < 0.8) return VARIABLE_STAR_TARGET_ADU_MEDIUM
  return VARIABLE_STAR_TARGET_ADU_LARGE
}
