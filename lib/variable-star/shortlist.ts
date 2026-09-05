import type { VariableStarRow } from '@/lib/variable-star-catalog'
import {
  formatDecSexagesimal,
  formatRaSexagesimal,
} from '@/lib/variable-star/format'
import type { VariableStarFilterId } from '@/lib/variable-star/filters'
import {
  observabilityMetricsForWindow,
  observabilityScore,
  passesObservabilityGate,
} from '@/lib/variable-star/observability'
import {
  buildScoredCandidate,
  SHORTLIST_BUCKET_IDS,
  SHORTLIST_HIGH_PRIORITY_COUNT,
  SHORTLIST_MAX_PER_RA_HOUR,
  SHORTLIST_PER_BUCKET,
  type ScoredCandidate,
} from '@/lib/variable-star/scoring'
import { isFamousVariableStar } from '@/lib/variable-star/famous'
import {
  vsxVizierUrl,
  vsxRowToCandidate,
  type VsxStreamRow,
} from '@/lib/variable-star/vsx'
import { get as httpGet } from 'node:https'

export type ShortlistBuildResult = {
  asOf: string
  rows: VariableStarRow[]
  stats: {
    vsxRowsParsed: number
    candidates: number
    observable: number
    selected: number
  }
}

function fetchVsxStream(onRow: (row: VsxStreamRow) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    let parsed = 0
    let buffer = ''
    const req = httpGet(vsxVizierUrl(), (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`VSX VizieR HTTP ${res.statusCode}`))
        return
      }
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buffer += chunk
        let nl = buffer.indexOf('\n')
        while (nl >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (line.startsWith('#') || !line.trim()) {
            nl = buffer.indexOf('\n')
            continue
          }
          if (line.startsWith('Name') || line.startsWith('-') || line.startsWith(' ')) {
            nl = buffer.indexOf('\n')
            continue
          }
          const parts = line.split('\t')
          if (parts.length >= 7) {
            parsed += 1
            onRow({
              name: parts[0] ?? '',
              raDeg: parts[1] ?? '',
              decDeg: parts[2] ?? '',
              max: parts[3] ?? '',
              min: parts[4] ?? '',
              fMin: parts[5] ?? '',
              type: parts[6] ?? '',
              period: parts[7] ?? '',
            })
          }
          nl = buffer.indexOf('\n')
        }
      })
      res.on('end', () => resolve(parsed))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(600_000, () => {
      req.destroy(new Error('VSX VizieR download timed out'))
    })
  })
}

function raHourBin(raHours: number): number {
  return Math.floor(raHours / 2)
}

function pickTopForBucket(
  pool: ScoredCandidate[],
  bucket: VariableStarFilterId,
  limit: number,
  already: Set<string>,
  raBinCounts: Map<number, number>
): ScoredCandidate[] {
  const sorted = [...pool]
    .filter((s) => s.buckets.includes(bucket))
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))

  const picked: ScoredCandidate[] = []
  for (const s of sorted) {
    if (picked.length >= limit) break
    if (already.has(s.candidate.name)) continue
    const bin = raHourBin(s.raHours)
    const count = raBinCounts.get(bin) ?? 0
    if (count >= SHORTLIST_MAX_PER_RA_HOUR) continue
    picked.push(s)
    already.add(s.candidate.name)
    raBinCounts.set(bin, count + 1)
  }
  return picked
}

function toVariableStarRow(
  scored: ScoredCandidate,
  categories: VariableStarFilterId[],
  highPriority: boolean
): VariableStarRow {
  const c = scored.candidate
  return {
    name: c.name,
    raHours: scored.raHours,
    decDeg: c.decDeg,
    varType: c.varType,
    periodDays: c.periodDays,
    minMag: c.minMag ?? c.faintestMag,
    maxMag: c.maxMag ?? (c.faintestMag != null && c.amplitude != null ? c.faintestMag - c.amplitude : c.faintestMag),
    highPriority,
    categories: [...categories],
  }
}

export async function buildVariableStarShortlist(now = new Date()): Promise<ShortlistBuildResult> {
  const asOf = now.toISOString()
  const scoredPool: ScoredCandidate[] = []
  let vsxRowsParsed = 0
  let candidates = 0

  await fetchVsxStream((row) => {
    vsxRowsParsed += 1
    const candidate = vsxRowToCandidate(row)
    if (!candidate) return
    candidates += 1
    const metrics = observabilityMetricsForWindow(candidate.raDeg / 15, candidate.decDeg, now)
    if (!passesObservabilityGate(metrics)) return
    const obsScore = observabilityScore(metrics)
    scoredPool.push(buildScoredCandidate(candidate, metrics, obsScore))
  })

  const classicalOrTyped = scoredPool.filter(
    (s) => s.candidate.isClassicalName || s.buckets.some((b) => b.startsWith('type_'))
  )
  const pool = classicalOrTyped.length >= 500 ? classicalOrTyped : scoredPool

  const already = new Set<string>()
  const categoryByName = new Map<string, Set<VariableStarFilterId>>()
  const scoredByName = new Map<string, ScoredCandidate>()

  for (const s of scoredPool) {
    scoredByName.set(s.candidate.name, s)
  }

  for (const bucket of SHORTLIST_BUCKET_IDS) {
    const raBinCounts = new Map<number, number>()
    const picked = pickTopForBucket(pool, bucket, SHORTLIST_PER_BUCKET, already, raBinCounts)
    for (const s of picked) {
      const set = categoryByName.get(s.candidate.name) ?? new Set<VariableStarFilterId>()
      set.add(bucket)
      categoryByName.set(s.candidate.name, set)
    }
  }

  const globalTop = [...pool]
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, SHORTLIST_HIGH_PRIORITY_COUNT)
  const highPriorityNames = new Set(globalTop.map((s) => s.candidate.name))

  for (const s of globalTop) {
    already.add(s.candidate.name)
    const set = categoryByName.get(s.candidate.name) ?? new Set<VariableStarFilterId>()
    categoryByName.set(s.candidate.name, set)
  }

  const rows: VariableStarRow[] = []
  const selectedNames: string[] = []
  already.forEach((n) => selectedNames.push(n))
  selectedNames.sort((a, b) => a.localeCompare(b))
  for (const name of selectedNames) {
    const scored = scoredByName.get(name)
    if (!scored) continue
    const catSet = categoryByName.get(name)
    const categories: VariableStarFilterId[] = []
    if (catSet) catSet.forEach((c) => categories.push(c))
    if (isFamousVariableStar(name) && !categories.includes('famous')) {
      categories.push('famous')
    }
    categories.sort()
    rows.push(toVariableStarRow(scored, categories, highPriorityNames.has(name)))
  }

  return {
    asOf,
    rows,
    stats: {
      vsxRowsParsed,
      candidates,
      observable: scoredPool.length,
      selected: rows.length,
    },
  }
}

export function shortlistToCsv(result: ShortlistBuildResult): string {
  const header =
    '"Star Name","RA (J2000.0)","Dec (J2000.0)","Var. Type","Min Mag","Max Mag","Period (d)","High Priority","Categories"'
  const lines = [header]
  for (const row of result.rows) {
    const period =
      row.periodDays == null ? '' : String(row.periodDays)
    const minMag = row.minMag == null ? '' : `${row.minMag.toFixed(1)} V`
    const maxMag = row.maxMag == null ? '' : `${row.maxMag.toFixed(1)} V`
    const hp = row.highPriority ? 'yes' : ''
    const cats = (row.categories ?? []).join('|')
    lines.push(
      [
        csvCell(row.name),
        csvCell(formatRaSexagesimal(row.raHours)),
        csvCell(formatDecSexagesimal(row.decDeg)),
        csvCell(row.varType ?? ''),
        csvCell(minMag),
        csvCell(maxMag),
        csvCell(period),
        csvCell(hp),
        csvCell(cats),
      ].join(',')
    )
  }
  lines.push(`# as_of=${result.asOf}`)
  lines.push(
    `# stats=vsx:${result.stats.vsxRowsParsed} candidates:${result.stats.candidates} observable:${result.stats.observable} selected:${result.stats.selected}`
  )
  return lines.join('\n') + '\n'
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return `"${value}"`
}
