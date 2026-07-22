import type { VariableStarRow } from '@/lib/variable-star-catalog'
import { isFamousVariableStar } from '@/lib/variable-star/famous'

/** UI / shortlist bucket ids (must match CSV Categories and filter checkboxes). */
export type VariableStarFilterId =
  | 'famous'
  | 'high_priority'
  | 'short_period'
  | 'mid_period'
  | 'long_period'
  | 'type_na'
  | 'type_lc'
  | 'type_m'
  | 'type_src'
  | 'type_ea'
  | 'type_cv'
  | 'type_rr'
  | 'type_cep'

export const VARIABLE_STAR_FILTER_OPTIONS: ReadonlyArray<{
  value: VariableStarFilterId
  label: string
}> = [
  { value: 'famous', label: 'Famous' },
  { value: 'high_priority', label: 'High Priority' },
  { value: 'short_period', label: 'Short Period' },
  { value: 'mid_period', label: 'Mid Period (1-100 Days)' },
  { value: 'long_period', label: 'Long Period (100+ Days)' },
  { value: 'type_na', label: 'Type: NA (Nova)' },
  { value: 'type_lc', label: 'Type: LC (Irregular Slow)' },
  { value: 'type_m', label: 'Type: M (Mira)' },
  { value: 'type_src', label: 'Type: SRC (Semiregular Supergiant)' },
  { value: 'type_ea', label: 'Type: EA (Algol Eclipsing Binary)' },
  { value: 'type_cv', label: 'Type: CV (Cataclysmic)' },
  { value: 'type_rr', label: 'Type: RR (RR Lyrae)' },
  { value: 'type_cep', label: 'Type: CEP (Cepheid)' },
]

export const PERIOD_FILTER_IDS: VariableStarFilterId[] = [
  'short_period',
  'mid_period',
  'long_period',
]

export const TYPE_FILTER_IDS: VariableStarFilterId[] = [
  'type_na',
  'type_lc',
  'type_m',
  'type_src',
  'type_ea',
  'type_cv',
  'type_rr',
  'type_cep',
]

function varTypeUpper(row: VariableStarRow): string {
  return (row.varType ?? '').toUpperCase()
}

function varTypeTokens(row: VariableStarRow): string[] {
  const raw = varTypeUpper(row)
  if (!raw) return []
  return raw.split('|').map((t) => t.replace(/:+$/, '').trim()).filter(Boolean)
}

function typeTokenMatches(filter: VariableStarFilterId, token: string): boolean {
  const t = token
  if (filter === 'type_na') return /\bN[A-Z]?\b/.test(t) || t.includes('NOVA') || t === 'SN'
  if (filter === 'type_lc') return t.includes('LC') || t === 'L' || t.includes('LB') || t.includes('RC')
  if (filter === 'type_m') return t === 'M' || t.includes('MIRA') || t === 'SR' || t.includes('SRA')
  if (filter === 'type_src') return t.includes('SRC')
  if (filter === 'type_ea') return t.includes('EA') || t.includes('EB') || t.includes('EW') || t.includes('ELL')
  if (filter === 'type_cv') {
    return (
      t.includes('UG') ||
      t.includes('CV') ||
      t.includes('ZAND') ||
      t.includes('WZ') ||
      t.includes('AM') ||
      t.includes('DQ') ||
      t.includes('IP') ||
      t.includes('NL') ||
      t.includes('NR') ||
      t === 'SS' ||
      t === 'SU'
    )
  }
  if (filter === 'type_rr') return t.includes('RR')
  if (filter === 'type_cep') return t.includes('CEP') || t.includes('DCEP') || t.includes('CWA') || t.includes('CWB')
  return false
}

function hasCategory(row: VariableStarRow, id: VariableStarFilterId): boolean {
  return (row.categories ?? []).includes(id)
}

export function rowMatchesPeriodFilter(row: VariableStarRow, filter: VariableStarFilterId): boolean {
  if (hasCategory(row, filter)) return true
  const p = row.periodDays
  if (p == null) return false
  if (filter === 'short_period') return p < 1
  if (filter === 'mid_period') return p >= 1 && p < 100
  if (filter === 'long_period') return p >= 100
  return false
}

export function rowMatchesTypeFilter(row: VariableStarRow, filter: VariableStarFilterId): boolean {
  if (hasCategory(row, filter)) return true
  const tokens = varTypeTokens(row)
  if (tokens.length === 0) return false
  return tokens.some((token) => typeTokenMatches(filter, token))
}

export function rowMatchesFilter(row: VariableStarRow, filter: VariableStarFilterId): boolean {
  if (filter === 'famous') return hasCategory(row, 'famous') || isFamousVariableStar(row.name)
  if (filter === 'high_priority') return row.highPriority
  if (PERIOD_FILTER_IDS.includes(filter)) return rowMatchesPeriodFilter(row, filter)
  if (TYPE_FILTER_IDS.includes(filter)) return rowMatchesTypeFilter(row, filter)
  return false
}

/** Same AND/OR rules as Remote variable-star filter dropdown. */
export function filterVariableStarCatalog(
  rows: VariableStarRow[],
  selected: VariableStarFilterId[]
): VariableStarRow[] {
  if (selected.length === 0) return rows

  const selectedSet = new Set(selected)
  const periodSelected = PERIOD_FILTER_IDS.filter((id) => selectedSet.has(id))
  const typeSelected = TYPE_FILTER_IDS.filter((id) => selectedSet.has(id))

  let filtered = rows
  if (selectedSet.has('famous')) {
    filtered = filtered.filter((s) => rowMatchesFilter(s, 'famous'))
  }
  if (selectedSet.has('high_priority')) {
    filtered = filtered.filter((s) => s.highPriority)
  }
  if (periodSelected.length > 0) {
    filtered = filtered.filter((s) => periodSelected.some((f) => rowMatchesPeriodFilter(s, f)))
  }
  if (typeSelected.length > 0) {
    filtered = filtered.filter((s) => typeSelected.some((f) => rowMatchesTypeFilter(s, f)))
  }
  return filtered
}

export function inferShortlistBuckets(row: VariableStarRow): VariableStarFilterId[] {
  const out: VariableStarFilterId[] = []
  for (const id of PERIOD_FILTER_IDS) {
    if (rowMatchesPeriodFilter(row, id)) out.push(id)
  }
  for (const id of TYPE_FILTER_IDS) {
    if (rowMatchesTypeFilter(row, id)) out.push(id)
  }
  return out
}
