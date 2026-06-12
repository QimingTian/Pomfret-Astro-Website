/** Borean, CT — US Eastern (EST/EDT). */
export const EST_TIME_ZONE = 'America/New_York'

export function formatEstDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: EST_TIME_ZONE,
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
