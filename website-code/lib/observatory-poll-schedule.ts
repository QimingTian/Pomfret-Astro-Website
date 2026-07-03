import { getDaytimeClosedWindowDetail } from '@/lib/sunrise-window'

export type ObservatoryPollKind =
  | 'site'
  | 'queue'
  | 'mount'
  | 'progress'
  | 'preview'
  | 'observatory'

type PollOptions = {
  /** Session terminal is showing an in-progress imaging queue row. */
  imagingActive?: boolean
  /** `document.visibilityState === 'hidden'` */
  pageHidden?: boolean
}

/** True between nautical dusk and next nautical dawn (observatory operating night). */
export function isObservatoryNight(now = new Date()): boolean {
  return !getDaytimeClosedWindowDetail(now).within
}

/** Ms until daytime ↔ night flip (min 60s) — reschedule polls at twilight. */
export function msUntilObservatoryPhaseChange(now = new Date()): number {
  const detail = getDaytimeClosedWindowDetail(now)
  const dawn = new Date(detail.nauticalDawnUtc).getTime()
  const dusk = new Date(detail.nauticalDuskUtc).getTime()
  const t = now.getTime()

  let next: number
  if (detail.within) {
    next = dusk
  } else if (t < dawn) {
    next = dawn
  } else {
    const tomorrow = new Date(now)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    next = new Date(getDaytimeClosedWindowDetail(tomorrow).nauticalDawnUtc).getTime()
  }

  return Math.max(60_000, next - t)
}

const DAY_MS = 20 * 60_000
const NIGHT_SITE_MS = 30_000
const NIGHT_QUEUE_MS = 60_000
const NIGHT_MOUNT_MS = 2_000
const NIGHT_PROGRESS_MS = 2_500
const NIGHT_PROGRESS_IMAGING_MS = 2_000
const NIGHT_PREVIEW_MS = 5_000
const NIGHT_PREVIEW_IMAGING_MS = 3_000
const HIDDEN_MULTIPLIER = 4

/**
 * Adaptive client poll interval. Daytime defaults are very slow; nighttime is responsive.
 * Hidden tabs poll even less (×4).
 */
export function observatoryPollIntervalMs(
  kind: ObservatoryPollKind,
  options: PollOptions = {},
  now = new Date()
): number {
  const night = isObservatoryNight(now)
  const imaging = options.imagingActive === true
  const hidden = options.pageHidden === true

  let base: number
  switch (kind) {
    case 'site':
    case 'observatory':
      base = night ? NIGHT_SITE_MS : DAY_MS
      break
    case 'queue':
      base = night ? NIGHT_QUEUE_MS : DAY_MS
      break
    case 'mount':
      base = night ? NIGHT_MOUNT_MS : DAY_MS
      break
    case 'progress':
      base = night ? (imaging ? NIGHT_PROGRESS_IMAGING_MS : NIGHT_PROGRESS_MS) : DAY_MS
      break
    case 'preview':
      base = night ? (imaging ? NIGHT_PREVIEW_IMAGING_MS : NIGHT_PREVIEW_MS) : DAY_MS
      break
    default:
      base = night ? NIGHT_SITE_MS : DAY_MS
  }

  if (hidden) return base * HIDDEN_MULTIPLIER
  return base
}
