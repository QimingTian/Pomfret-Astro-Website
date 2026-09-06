import { readFile } from 'fs/promises'
import path from 'path'

import {
  DEFAULT_OBSERVATORY_SITE_ID,
  isObservatorySiteId,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'
import { variableStarCatalogRelativePath } from '@/lib/variable-star/vsx'

export type VariableStarRow = {
  name: string
  raHours: number
  decDeg: number
  varType: string | null
  periodDays: number | null
  minMag: number | null
  maxMag: number | null
  highPriority: boolean
  /** Shortlist bucket tags from weekly build (e.g. type_cv|short_period). */
  categories?: string[]
}

const cacheBySite = new Map<string, VariableStarRow[]>()

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => {
    const t = s.trim()
    if (t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1).replace(/""/g, '"')
    }
    return t
  })
}

export function parseRaHoursSexagesimal(ra: string): number | null {
  const m = ra.trim().match(/^(\d+)h\s*(\d+)m\s*([\d.]+)s$/i)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3])
  if (![h, min, sec].every((x) => Number.isFinite(x))) return null
  return h + min / 60 + sec / 3600
}

export function parseDecDegSexagesimal(dec: string): number | null {
  const m = dec.trim().match(/^([+-]?)(\d+)d\s*(\d+)m\s*([\d.]+)s$/i)
  if (!m) return null
  const signNeg = m[1] === '-'
  const deg = Number(m[2])
  const min = Number(m[3])
  const sec = Number(m[4])
  if (![deg, min, sec].every((x) => Number.isFinite(x))) return null
  const v = deg + min / 60 + sec / 3600
  return signNeg ? -v : v
}

export function parseCatalogMagField(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  const m = s.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

export function parsePeriodDaysField(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s || s.toLowerCase() === 'none') return null
  const v = Number(s)
  if (!Number.isFinite(v) || v <= 0) return null
  return v
}

function parseIndexCsv(text: string): VariableStarRow[] {
  const lines = text.split(/\r?\n/).filter((l) => {
    const t = l.trim()
    return t.length > 0 && !t.startsWith('#')
  })
  if (lines.length < 2) return []
  const header = parseCsvLine(lines[0])
  const idxName = header.findIndex((h) => h === 'Star Name')
  const idxRa = header.findIndex((h) => h === 'RA (J2000.0)')
  const idxDec = header.findIndex((h) => h === 'Dec (J2000.0)')
  const idxMinMag = header.findIndex((h) => h === 'Min Mag')
  const idxMaxMag = header.findIndex((h) => h === 'Max Mag')
  const idxPeriod = header.findIndex((h) => h === 'Period (d)')
  const idxVarType = header.findIndex((h) => h === 'Var. Type')
  const idxHighPriority = header.findIndex((h) => h === 'High Priority')
  const idxCategories = header.findIndex((h) => h === 'Categories')
  if (idxName === -1 || idxRa === -1 || idxDec === -1) return []
  const out: VariableStarRow[] = []
  const seenCoreSignatures = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const name = cols[idxName]?.trim()
    const raStr = cols[idxRa]?.trim()
    const decStr = cols[idxDec]?.trim()
    if (!name || !raStr || !decStr) continue
    const raHours = parseRaHoursSexagesimal(raStr)
    const decDeg = parseDecDegSexagesimal(decStr)
    if (raHours == null || decDeg == null) continue
    const minMag = parseCatalogMagField(idxMinMag >= 0 ? cols[idxMinMag] : undefined)
    const maxMag = parseCatalogMagField(idxMaxMag >= 0 ? cols[idxMaxMag] : undefined)
    const periodDays = parsePeriodDaysField(idxPeriod >= 0 ? cols[idxPeriod] : undefined)
    const varTypeRaw = idxVarType >= 0 ? String(cols[idxVarType] ?? '').trim() : ''
    const varType = varTypeRaw.length > 0 ? varTypeRaw.toUpperCase() : null
    const highPriority = idxHighPriority >= 0 && String(cols[idxHighPriority] ?? '').trim().length > 0
    const categoriesRaw = idxCategories >= 0 ? String(cols[idxCategories] ?? '').trim() : ''
    const categories =
      categoriesRaw.length > 0
        ? categoriesRaw.split('|').map((c) => c.trim()).filter((c) => c.length > 0)
        : undefined
    const coreSignature = [
      name,
      raHours.toFixed(8),
      decDeg.toFixed(8),
      periodDays == null ? 'null' : periodDays.toFixed(8),
      minMag == null ? 'null' : minMag.toFixed(8),
      maxMag == null ? 'null' : maxMag.toFixed(8),
    ].join('|')
    if (seenCoreSignatures.has(coreSignature)) continue
    seenCoreSignatures.add(coreSignature)
    out.push({ name, raHours, decDeg, varType, periodDays, minMag, maxMag, highPriority, categories })
  }
  return out
}

function resolveSiteId(siteId?: ObservatorySiteId | string | null): ObservatorySiteId {
  if (siteId && isObservatorySiteId(siteId)) return siteId
  const current = currentObservatorySiteId()
  return isObservatorySiteId(current) ? current : DEFAULT_OBSERVATORY_SITE_ID
}

async function readCatalogCsv(siteId: ObservatorySiteId): Promise<string> {
  const rel = variableStarCatalogRelativePath(siteId)
  // Keep site file names as string literals (not only via `rel`) so file tracers can see them.
  const candidates =
    siteId === 'cygnus'
      ? [
          path.join(process.cwd(), 'Variables', 'index.cygnus.csv'),
          path.join(process.cwd(), '..', 'Variables', 'index.cygnus.csv'),
          path.join(process.cwd(), rel),
          path.join(process.cwd(), '..', rel),
        ]
      : [
          path.join(process.cwd(), 'Variables', 'index.csv'),
          path.join(process.cwd(), '..', 'Variables', 'index.csv'),
          path.join(process.cwd(), rel),
          path.join(process.cwd(), '..', rel),
        ]
  for (const csvPath of candidates) {
    try {
      return await readFile(csvPath, 'utf-8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  throw new Error(
    `Variable star catalog missing (${rel}). Ensure it is deployed and included in experimental.outputFileTracingIncludes.`
  )
}

export async function loadVariableStarCatalog(
  siteId?: ObservatorySiteId | string | null
): Promise<VariableStarRow[]> {
  const id = resolveSiteId(siteId)
  const cached = cacheBySite.get(id)
  if (cached) return cached
  const raw = await readCatalogCsv(id)
  const rows = parseIndexCsv(raw)
  cacheBySite.set(id, rows)
  return rows
}

export function clearVariableStarCatalogCache(siteId?: ObservatorySiteId | string | null): void {
  if (siteId == null) {
    cacheBySite.clear()
    return
  }
  cacheBySite.delete(resolveSiteId(siteId))
}
