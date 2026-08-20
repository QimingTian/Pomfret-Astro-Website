/** True when reconcile has set a planned start and wall clock has reached it. */
export function plannedStartIsDue(plannedStartIso: string | null | undefined, nowMs: number): boolean {
  if (plannedStartIso == null || plannedStartIso.length === 0) return false
  const startMs = Date.parse(plannedStartIso)
  if (!Number.isFinite(startMs)) return false
  return nowMs >= startMs
}
