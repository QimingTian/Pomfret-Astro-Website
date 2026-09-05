import {
  DEFAULT_OBSERVATORY_SITE_ID,
  POMFRET_SITE,
  type ObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { currentObservatorySite } from '@/lib/observatory-site-scope'

/**
 * Shared network faintness ceiling (Bortle 4 / FSQ-106 + ASI2600MM Pro G).
 * Per-site optics limits can replace this later; geography drives Dec / night gates.
 */
export const NETWORK_FAINTEST_MAG_LIMIT = 14.0

/** @deprecated Prefer NETWORK_FAINTEST_MAG_LIMIT */
export const POMFRET_FAINTEST_MAG_LIMIT = NETWORK_FAINTEST_MAG_LIMIT

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

/** Dec such that meridian altitude >= 30° at the site (`lat - 60`). */
export function minDecDegForSite(site: ObservatorySite = currentObservatorySite()): number {
  return site.observerLatDeg - 60
}

/** @deprecated Prefer minDecDegForSite() */
export const POMFRET_MIN_DEC_DEG = minDecDegForSite(POMFRET_SITE)

export function decPassesMeridianAlt(
  decDeg: number,
  site: ObservatorySite = currentObservatorySite()
): boolean {
  return decDeg >= minDecDegForSite(site) - 1e-6
}

/** @deprecated Prefer decPassesMeridianAlt */
export function decPassesPomfretMeridianAlt(decDeg: number): boolean {
  return decPassesMeridianAlt(decDeg)
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
  return faintestMag <= NETWORK_FAINTEST_MAG_LIMIT
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

export function vsxRowToCandidate(
  row: VsxStreamRow,
  site: ObservatorySite = currentObservatorySite()
): VsxCandidate | null {
  const name = row.name.trim()
  if (!name) return null
  const raDeg = Number(row.raDeg)
  const decDeg = Number(row.decDeg)
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null
  if (!decPassesMeridianAlt(decDeg, site)) return null

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

export function vsxVizierUrl(site: ObservatorySite = currentObservatorySite()): string {
  const minDec = minDecDegForSite(site)
  return (
    'https://vizier.cds.unistra.fr/viz-bin/asu-tsv?' +
    '-source=B/vsx&' +
    '-out=Name&-out=RAJ2000&-out=DEJ2000&-out=max&-out=min&-out=f_min&-out=Type&-out=Period&' +
    `DEJ2000=${minDec.toFixed(3)}..89.91&V=0&max=0.0..15.0&` +
    '-out.max=9999999'
  )
}

/** @deprecated Prefer vsxVizierUrl() */
export const VSX_VIZIER_URL = vsxVizierUrl(POMFRET_SITE)

export function variableStarCatalogRelativePath(siteId: ObservatorySiteId | string): string {
  if (siteId === DEFAULT_OBSERVATORY_SITE_ID || siteId === 'pomfret') {
    return 'Variables/index.csv'
  }
  return `Variables/index.${siteId}.csv`
}
