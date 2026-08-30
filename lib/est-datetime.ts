import { POMFRET_SITE } from '@/lib/observatory-sites'

/** @deprecated Pomfret alias — prefer `formatObservatoryDateTime(d, site.timezone)`. */
export const EST_TIME_ZONE = POMFRET_SITE.timezone

/** Wall clock for map overlays / UI timestamps in an observatory IANA timezone. */
export function formatObservatoryDateTime(d: Date, timeZone: string): string {
  return d.toLocaleString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

/** @deprecated Prefer `formatObservatoryDateTime` with the active site timezone. */
export function formatEstDateTime(d: Date): string {
  return formatObservatoryDateTime(d, EST_TIME_ZONE)
}
