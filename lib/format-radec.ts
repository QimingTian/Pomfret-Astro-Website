/** Display helpers for J2000 equatorial coordinates (integer HMS / DMS, no decimals). */

export function formatRaHoursHms(raHours: number): string {
  if (!Number.isFinite(raHours)) return '—'
  const wrapped = ((raHours % 24) + 24) % 24
  let totalSec = Math.round(wrapped * 3600)
  if (totalSec >= 24 * 3600) totalSec = 0
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

export function formatDecDegDms(decDeg: number): string {
  if (!Number.isFinite(decDeg)) return '—'
  const sign = decDeg < 0 ? '−' : '+'
  const abs = Math.min(90, Math.abs(decDeg))
  let totalSec = Math.round(abs * 3600)
  if (totalSec > 90 * 3600) totalSec = 90 * 3600
  const d = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`
}

/** e.g. `12h 34m 56s / +41° 12′ 30″` */
export function formatRaDecPair(raHours: number, decDeg: number): string {
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return '—'
  return `${formatRaHoursHms(raHours)} / ${formatDecDegDms(decDeg)}`
}

/** Compact target label when the user did not supply a name. */
export function formatRaDecTargetLabel(raHours: number, decDeg: number): string {
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return 'Untitled target'
  return `RA ${formatRaHoursHms(raHours)} · Dec ${formatDecDegDms(decDeg)}`
}
