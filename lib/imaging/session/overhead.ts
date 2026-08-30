import { hourAngleDeg, localSiderealTimeHours } from '@/lib/mount-gem-angles'

/** DSO / project base overhead (slew / settle / focus buffer). */
export const DSO_SESSION_OVERHEAD_SEC = 40 * 60

/** Extra when the planned session block crosses the local meridian. */
export const DSO_MERIDIAN_FLIP_OVERHEAD_SEC = 10 * 60

/** Extra per filter beyond the first (filter change + refocus). */
export const DSO_EXTRA_FILTER_OVERHEAD_SEC = 5 * 60

/** Variable star: total = (N × 0.5 h block) + overhead; stripped when building NINA JSON. */
export const VARIABLE_STAR_SESSION_OVERHEAD_SEC = 30 * 60

/** Extra when the planned variable-star block crosses the local meridian. */
export const VARIABLE_STAR_MERIDIAN_FLIP_OVERHEAD_SEC = DSO_MERIDIAN_FLIP_OVERHEAD_SEC

export type VariableStarOverheadInput = {
  /** Target RA (hours). With startMs, enables meridian-flip overhead. */
  raHours?: number
  /** Planned session start (ms). Without this, meridian flip is not added. */
  startMs?: number
  /** Imaging block seconds (N × 0.5 h). Used with startMs for meridian detection. */
  blockSeconds?: number
}

export function variableStarSessionOverheadSeconds(input: VariableStarOverheadInput = {}): number {
  const base = VARIABLE_STAR_SESSION_OVERHEAD_SEC
  const blockSec =
    input.blockSeconds != null && Number.isFinite(input.blockSeconds)
      ? Math.max(0, input.blockSeconds)
      : 0
  const startMs = input.startMs
  const raHours = input.raHours
  if (
    startMs == null ||
    !Number.isFinite(startMs) ||
    raHours == null ||
    !Number.isFinite(raHours)
  ) {
    return base
  }
  const provisionalEndMs = startMs + (blockSec + base) * 1000
  const flip = sessionCrossesMeridian(raHours, startMs, provisionalEndMs)
    ? VARIABLE_STAR_MERIDIAN_FLIP_OVERHEAD_SEC
    : 0
  return base + flip
}

export function variableStarSessionDurationSeconds(input: {
  blockHours: number
  raHours?: number
  startMs?: number
}): number {
  const blockSec = Math.max(0, input.blockHours) * 3600
  return (
    blockSec +
    variableStarSessionOverheadSeconds({
      raHours: input.raHours,
      startMs: input.startMs,
      blockSeconds: blockSec,
    })
  )
}

/** Reverse client total duration → block hours when it matches a valid ladder step. */
export function variableStarBlockHoursFromTotalSeconds(
  totalSec: number,
  opts?: { raHours?: number; startMs?: number }
): number | null {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return null
  for (let halves = 1; halves <= 48; halves += 1) {
    const blockHours = halves * 0.5
    const expected = variableStarSessionDurationSeconds({
      blockHours,
      raHours: opts?.raHours,
      startMs: opts?.startMs,
    })
    if (Math.abs(totalSec - expected) <= 1) return blockHours
  }
  return null
}

export type DsoOverheadFilterPlan = {
  filterName: string
  exposureSeconds: number
  count: number
}

export type DsoSessionOverheadInput = {
  filterPlans: DsoOverheadFilterPlan[]
  /** Target RA (hours). With startMs, enables meridian-flip overhead. */
  raHours?: number
  /** Planned session start (ms). Without this, meridian flip is not added. */
  startMs?: number
  /**
   * Pure imaging seconds. Defaults to Σ(count × exposure).
   * Used with startMs to build the provisional end for meridian detection.
   */
  imagingSeconds?: number
}

/** Distinct filters that still have at least one frame in this session. */
export function distinctFiltersWithFrames(filterPlans: DsoOverheadFilterPlan[]): number {
  const names = new Set<string>()
  for (const p of filterPlans) {
    if (p.count > 0 && p.filterName) names.add(p.filterName)
  }
  return names.size
}

/**
 * True when local hour angle crosses the meridian (HA sign change / through 0°)
 * during [startMs, endMs]. Samples the window (HA moves ~15°/h).
 */
export function sessionCrossesMeridian(raHours: number, startMs: number, endMs: number): boolean {
  if (!Number.isFinite(raHours) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return false
  if (endMs <= startMs) return false

  const sampleStepMs = 5 * 60 * 1000
  const times: number[] = []
  for (let t = startMs; t < endMs; t += sampleStepMs) times.push(t)
  times.push(endMs)

  let prevHa: number | null = null
  for (const t of times) {
    const ha = hourAngleDeg(raHours, localSiderealTimeHours(new Date(t)))
    if (prevHa != null) {
      // Meridian transit: HA goes east→west through 0° (or west→east).
      if ((prevHa < 0 && ha >= 0) || (prevHa > 0 && ha <= 0)) return true
    }
    prevHa = ha
  }
  return false
}

export function imagingSecondsFromFilterPlans(filterPlans: DsoOverheadFilterPlan[]): number {
  return filterPlans.reduce((sum, p) => sum + Math.max(0, p.count) * Math.max(0, p.exposureSeconds), 0)
}

/**
 * DSO / project session overhead:
 *   40 min base
 * + 5 min × (distinctFilters − 1) when more than one filter
 * + 10 min if [start, start+imaging+base+filterExtra] crosses the meridian
 *
 * Without startMs or raHours, meridian flip is omitted (form / queue submit estimates).
 */
export function dsoSessionOverheadSeconds(input: DsoSessionOverheadInput): number {
  const filterCount = distinctFiltersWithFrames(input.filterPlans)
  const filterExtra =
    filterCount > 1 ? (filterCount - 1) * DSO_EXTRA_FILTER_OVERHEAD_SEC : 0
  const baseAndFilters = DSO_SESSION_OVERHEAD_SEC + filterExtra

  const imaging =
    input.imagingSeconds != null && Number.isFinite(input.imagingSeconds)
      ? Math.max(0, input.imagingSeconds)
      : imagingSecondsFromFilterPlans(input.filterPlans)

  const startMs = input.startMs
  const raHours = input.raHours
  if (
    startMs == null ||
    !Number.isFinite(startMs) ||
    raHours == null ||
    !Number.isFinite(raHours)
  ) {
    return baseAndFilters
  }

  const provisionalEndMs = startMs + (imaging + baseAndFilters) * 1000
  const flip = sessionCrossesMeridian(raHours, startMs, provisionalEndMs)
    ? DSO_MERIDIAN_FLIP_OVERHEAD_SEC
    : 0
  return baseAndFilters + flip
}

export function dsoSessionDurationSeconds(input: DsoSessionOverheadInput): number {
  const imaging =
    input.imagingSeconds != null && Number.isFinite(input.imagingSeconds)
      ? Math.max(0, input.imagingSeconds)
      : imagingSecondsFromFilterPlans(input.filterPlans)
  if (imaging <= 0 && distinctFiltersWithFrames(input.filterPlans) === 0) {
    return dsoSessionOverheadSeconds({ ...input, imagingSeconds: 0, filterPlans: input.filterPlans })
  }
  return imaging + dsoSessionOverheadSeconds({ ...input, imagingSeconds: imaging })
}
