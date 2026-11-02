import {
  DSO_SESSION_OVERHEAD_SEC,
  DSO_DITHER_OVERHEAD_SEC,
  dsoSessionDurationSeconds,
} from '@/lib/imaging-session-overhead'

export function estimateDurationSecondsFromPlans(
  plans: Array<{ filterName: string; exposureSeconds: number; count: number }> | undefined,
  opts?: { raHours?: number; startMs?: number; ditherEnabled?: boolean }
): number {
  if (!Array.isArray(plans) || plans.length === 0) {
    return DSO_SESSION_OVERHEAD_SEC + (opts?.ditherEnabled === true ? DSO_DITHER_OVERHEAD_SEC : 0)
  }
  return Math.max(
    dsoSessionDurationSeconds({
      filterPlans: plans,
      raHours: opts?.raHours,
      startMs: opts?.startMs,
      ditherEnabled: opts?.ditherEnabled,
    }),
    DSO_SESSION_OVERHEAD_SEC
  )
}
