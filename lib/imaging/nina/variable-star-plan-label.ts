import { variableStarTargetAduFromAmplitude } from '@/lib/imaging/nina/variable-star-target-adu'

/** Resolve session-end clock for variable-star Imaging Plan copy. */
export function variableStarMonitorUntilMs(opts: {
  scheduleBarEndMs?: number | null
  scheduleBarStartMs?: number | null
  plannedStartIso?: string | null
  estimatedDurationSeconds?: number | null
}): number | null {
  if (typeof opts.scheduleBarEndMs === 'number' && Number.isFinite(opts.scheduleBarEndMs)) {
    return opts.scheduleBarEndMs
  }
  const durationSec =
    typeof opts.estimatedDurationSeconds === 'number' &&
    Number.isFinite(opts.estimatedDurationSeconds) &&
    opts.estimatedDurationSeconds > 0
      ? opts.estimatedDurationSeconds
      : null
  if (durationSec != null) {
    if (typeof opts.scheduleBarStartMs === 'number' && Number.isFinite(opts.scheduleBarStartMs)) {
      return opts.scheduleBarStartMs + durationSec * 1000
    }
    if (typeof opts.plannedStartIso === 'string') {
      const start = Date.parse(opts.plannedStartIso)
      if (Number.isFinite(start)) return start + durationSec * 1000
    }
  }
  return null
}

/**
 * Variable-star Imaging Plan: time-bounded monitoring, not count × exposure.
 * Example: `G · Monitor until 1:30 AM · Dynamic exposure · Target ADU 30%`
 */
export function formatVariableStarImagingPlan(opts: {
  untilMs?: number | null
  amplitudeMag?: number | null
  filterName?: string | null
}): string {
  const filter = (opts.filterName?.trim() || 'G') || 'G'
  const untilMs = opts.untilMs
  const untilLabel =
    typeof untilMs === 'number' && Number.isFinite(untilMs)
      ? new Date(untilMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null
  const monitor = untilLabel ? `Monitor until ${untilLabel}` : 'Monitor until session end'
  const aduPct = Math.round(variableStarTargetAduFromAmplitude(opts.amplitudeMag) * 100)
  return `${filter} · ${monitor} · Dynamic exposure · Target ADU ${aduPct}%`
}
