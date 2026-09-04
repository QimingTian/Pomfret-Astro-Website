import { currentObservatorySite } from '@/lib/observatory-site-scope'

/** Dec such that meridian altitude >= 30° at the active site. */
export function minDecDegForSite(): number {
  return currentObservatorySite().observerLatDeg - 60
}

/** Faintest V mag reachable at Bortle 4 with FSQ-106 + ASI2600MM Pro (G filter). */
export const POMFRET_FAINTEST_MAG_LIMIT = 14.0

const SURVEY_NAME = /^(Gaia DR3|ZTF J|ASASSN|AT \d|PS1|WISE J|GSC2|USNO|SDSS|CSS_|2MASS|TYC \d)/i

export type VsxCandidate = {
  name: string
  raDeg: number
  decDeg: number
  varType: string | null
  periodDays: number | null
  maxMag: number | null
  minMag: number | null
  faintestMag: number | null
  amplitude: number | null
  isClassicalName: boolean
}

export function decPassesPomfretMeridianAlt(decDeg: number): boolean {
  return decDeg >= minDecDegForSite() - 1e-6
}

export function isClassicalVariableName(name: string): boolean {
  return !SURVEY_NAME.test(name.trim())
}

export function parseVsxMagPair(
  maxRaw: string,
  minRaw: string,
  fMin: string
): { maxMag: number | null; minMag: number | null; faintestMag: number | null; amplitude: number | null } {
  const maxMag = parseMagToken(maxRaw)
  const minMag = parseMagToken(minRaw)
  if (maxMag == null && minMag == null) {
    return { maxMag: null, minMag: null, faintestMag: null, amplitude: null }
  }
  if ((fMin === '(' || fMin === 'Y') && maxMag != null && minMag != null) {
    return { maxMag, minMag: null, faintestMag: maxMag + minMag, amplitude: minMag }
  }
  const faintestMag =
    maxMag != null && minMag != null ? Math.max(maxMag, minMag) : (minMag ?? maxMag)
  return { maxMag, minMag, faintestMag, amplitude: null }
}

function parseMagToken(raw: string): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const m = s.match(/^[<>]?\(?(\d+\.?\d*)/)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

export function parseVsxPeriod(raw: string): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const v = Number(s)
  if (!Number.isFinite(v) || v <= 0) return null
  return v
}

export function passesFaintestMagGate(faintestMag: number | null): boolean {
  if (faintestMag == null) return false
  return faintestMag <= POMFRET_FAINTEST_MAG_LIMIT
}

export type VsxStreamRow = {
  name: string
  raDeg: string
  decDeg: string
  max: string
  min: string
  fMin: string
  type: string
  period: string
}

export function vsxRowToCandidate(row: VsxStreamRow): VsxCandidate | null {
  const name = row.name.trim()
  if (!name) return null
  const raDeg = Number(row.raDeg)
  const decDeg = Number(row.decDeg)
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null
  if (!decPassesPomfretMeridianAlt(decDeg)) return null

  const { maxMag, minMag, faintestMag, amplitude } = parseVsxMagPair(row.max, row.min, row.fMin)
  if (!passesFaintestMagGate(faintestMag)) return null

  const varTypeRaw = row.type.trim()
  const varType = varTypeRaw.length > 0 ? varTypeRaw.toUpperCase() : null
  const periodDays = parseVsxPeriod(row.period)

  return {
    name,
    raDeg,
    decDeg,
    varType,
    periodDays,
    maxMag,
    minMag,
    faintestMag,
    amplitude,
    isClassicalName: isClassicalVariableName(name),
  }
}

export function vsxVizierUrl(): string {
  return (
    'https://vizier.cds.unistra.fr/viz-bin/asu-tsv?' +
    '-source=B/vsx&' +
    '-out=Name&-out=RAJ2000&-out=DEJ2000&-out=max&-out=min&-out=f_min&-out=Type&-out=Period&' +
    `DEJ2000=${minDecDegForSite().toFixed(3)}..89.91&V=0&max=0.0..15.0&` +
    '-out.max=9999999'
  )
}
