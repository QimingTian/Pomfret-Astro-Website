import type { VariableStarPreviewInput } from '@/lib/variable-star-preview-compute'
import type { VariableStarRow } from '@/lib/variable-star-catalog'

export type VariableStarChartStar = VariableStarPreviewInput & { name: string }

export function rowToVariableChartStar(row: VariableStarRow): VariableStarChartStar {
  return {
    name: row.name,
    raHours: row.raHours,
    decDeg: row.decDeg,
    periodDays: row.periodDays,
    minMag: row.minMag,
    maxMag: row.maxMag,
  }
}

export function pickVariableStarRow(
  catalog: VariableStarRow[],
  query: string
): { ok: true; row: VariableStarRow } | { ok: false; error: string } {
  const q = query.trim().toLowerCase()
  if (!q) return { ok: false, error: 'Enter a variable star name.' }
  const exact = catalog.filter((s) => s.name.toLowerCase() === q)
  if (exact.length === 1) return { ok: true, row: exact[0]! }
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Multiple catalog entries match "${query}" exactly. Use a more specific designation.`,
    }
  }
  const partial = catalog.filter((s) => s.name.toLowerCase().includes(q))
  if (partial.length === 1) return { ok: true, row: partial[0]! }
  if (partial.length === 0) {
    return { ok: false, error: `No variable star in the catalog matches "${query}".` }
  }
  if (partial.length > 20) {
    return {
      ok: false,
      error: `Too many matches (${partial.length}). Type a longer or more specific name.`,
    }
  }
  return {
    ok: false,
    error: `Multiple matches (${partial.length}). Examples: ${partial
      .slice(0, 8)
      .map((s) => s.name)
      .join(', ')}`,
  }
}
