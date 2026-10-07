/**
 * Sequence start, before the event. Prepare takes 20 minutes, so a 22 minute
 * lead opens the shutter about 2 minutes early.
 */
export const OCCULTATION_LEAD_SEC = 22 * 60

/** Measured connect, cool, open, slew, and solve time before the first exposure. */
export const OCCULTATION_PREPARE_SEC = 20 * 60

/**
 * Sub-frame exposure is chosen on the server from the star's Gaia G magnitude.
 * These bounds keep the cadence short enough to time the blink.
 * Unknown magnitude uses the reference exposure.
 */
export const OCCULTATION_EXPOSURE_MIN_SEC = 0.2
export const OCCULTATION_EXPOSURE_MAX_SEC = 1
export const OCCULTATION_EXPOSURE_REF_MAG = 12
export const OCCULTATION_EXPOSURE_REF_SEC = 1
export const OCCULTATION_EXPOSURE_SEC = OCCULTATION_EXPOSURE_REF_SEC

export const OCCULTATION_FILTER = 'L'

/** Keep exposing this long after the predicted instant. */
export const OCCULTATION_POST_PAD_SEC = 60

/** Same faint limit as the variable-star shortlist. */
export const OCCULTATION_MAG_MAX = 14

/**
 * Kilometres from the observatory to the predicted ground track.
 * The shadow is only as wide as the asteroid, so this stays tight enough
 * that a disappearance at the dome is still realistic.
 */
export const OCCULTATION_LOCATION_RADIUS_KM = 50

/** Avoid re-hitting the LIneA hourly cap while the Remote page stays open. */
export const OCCULTATION_FEED_CACHE_MS = 10 * 60 * 1000

export type OccultationExposurePlan = {
  plannedStartMs: number
  eventFinishMs: number
  exposureSeconds: number
  exposureCount: number
  estimatedDurationSeconds: number
}

/** Exposure for a constant star signal. Brighter stars get a shorter frame. */
export function occultationSubExposureSeconds(magnitude: number | null): number {
  if (magnitude == null || !Number.isFinite(magnitude)) return OCCULTATION_EXPOSURE_REF_SEC
  const raw =
    OCCULTATION_EXPOSURE_REF_SEC * 10 ** (0.4 * (magnitude - OCCULTATION_EXPOSURE_REF_MAG))
  const clamped = Math.min(OCCULTATION_EXPOSURE_MAX_SEC, Math.max(OCCULTATION_EXPOSURE_MIN_SEC, raw))
  return Math.round(clamped * 10) / 10
}

/**
 * The exposure loop starts after prepare, so the frame count is only the
 * imaging stretch: from when the shutter opens (lead minus prepare) through
 * one minute after the event. A blink longer than that minute extends the end.
 */
export function occultationExposurePlan(
  eventTimeMs: number,
  durationSeconds: number | null,
  exposureSeconds = OCCULTATION_EXPOSURE_SEC
): OccultationExposurePlan {
  const exposureSec =
    Number.isFinite(exposureSeconds) && exposureSeconds > 0 ? exposureSeconds : OCCULTATION_EXPOSURE_SEC
  const halfSec =
    durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds / 2
      : 0
  const postSec = Math.max(OCCULTATION_POST_PAD_SEC, halfSec)
  const imagingSec = OCCULTATION_LEAD_SEC - OCCULTATION_PREPARE_SEC + postSec
  const plannedStartMs = eventTimeMs - OCCULTATION_LEAD_SEC * 1000
  const eventFinishMs = eventTimeMs + postSec * 1000
  const exposureCount = Math.max(1, Math.ceil(imagingSec / exposureSec))
  return {
    plannedStartMs,
    eventFinishMs,
    exposureSeconds: exposureSec,
    exposureCount,
    estimatedDurationSeconds: OCCULTATION_LEAD_SEC + postSec,
  }
}
