/**
 * Planned starts are re-derived on every reconcile (agent poll cadence ~45 s). Sub-minute drift is
 * noise, not a schedule change: it must not rewrite the row or append an audit line.
 */
export const PLANNED_START_EPSILON_MS = 60_000

/**
 * True when both starts are already due. The row is waiting for the next agent poll, so a start
 * that tracks the clock carries no new information even though the stored value must stay accurate.
 */
export function plannedStartsBothDue(
  a: string | null | undefined,
  b: string | null | undefined,
  nowMs: number,
  toleranceMs = PLANNED_START_EPSILON_MS
): boolean {
  const aMs = a == null ? NaN : Date.parse(a)
  const bMs = b == null ? NaN : Date.parse(b)
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false
  return aMs <= nowMs + toleranceMs && bMs <= nowMs + toleranceMs
}

/** True when two planned starts describe the same schedule (both unset, or within `toleranceMs`). */
export function plannedStartsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
  toleranceMs = PLANNED_START_EPSILON_MS
): boolean {
  const aMs = a == null ? NaN : Date.parse(a)
  const bMs = b == null ? NaN : Date.parse(b)
  const aSet = Number.isFinite(aMs)
  const bSet = Number.isFinite(bMs)
  if (!aSet || !bSet) return aSet === bSet
  return Math.abs(aMs - bMs) < toleranceMs
}
