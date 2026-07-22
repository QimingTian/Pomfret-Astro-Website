import {
  DSO_SESSION_OVERHEAD_SEC,
  dsoSessionDurationSeconds,
} from '@/lib/imaging-session-overhead'

export function estimateDurationSecondsFromPlans(
  plans: Array<{ filterName: string; exposureSeconds: number; count: number }> | undefined,
  opts?: { raHours?: number; startMs?: number }
): number {
  if (!Array.isArray(plans) || plans.length === 0) return DSO_SESSION_OVERHEAD_SEC
  return Math.max(
    dsoSessionDurationSeconds({
      filterPlans: plans,
      raHours: opts?.raHours,
      startMs: opts?.startMs,
    }),
    DSO_SESSION_OVERHEAD_SEC
  )
}
