/** DSO / multi-night project: sum(exposure × frames) + this overhead for scheduling and ETA. */
export const DSO_SESSION_OVERHEAD_SEC = 25 * 60

/** Variable star: total = (N × 0.5 h block) + this overhead; stripped when building NINA JSON. */
export const VARIABLE_STAR_SESSION_OVERHEAD_SEC = 15 * 60
