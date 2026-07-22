export function formatRaSexagesimal(raHours: number): string {
  const h = Math.floor(raHours)
  const rem = (raHours - h) * 60
  const m = Math.floor(rem)
  const s = (rem - m) * 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(1)}s`
}

export function formatDecSexagesimal(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+'
  const abs = Math.abs(decDeg)
  const d = Math.floor(abs)
  const rem = (abs - d) * 60
  const m = Math.floor(rem)
  const s = (rem - m) * 60
  return `${sign}${String(d).padStart(2, '0')}d ${String(m).padStart(2, '0')}m ${s.toFixed(1)}s`
}

export function raDegToHours(raDeg: number): number {
  return raDeg / 15
}
