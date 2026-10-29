export type PlanResolvedCatalogObject = {
  canonicalName: string
  aliases: string[]
}

/** Extra designation shapes so Sesame-resolved names more often match the engine catalog (getObj). */
export function buildEngineResolveCandidates(
  resolved: PlanResolvedCatalogObject,
  rawQuery: string,
): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (t) out.add(t)
  }
  add(rawQuery)
  add(resolved.canonicalName)
  for (const a of resolved.aliases ?? []) add(a)
  for (const s of Array.from(out)) {
    const ngc = s.match(/\b(NGC|IC)\s*(\d{1,5})\b/i)
    if (ngc) {
      const abbr = ngc[1]!.toUpperCase()
      const num = ngc[2]!
      add(`${abbr} ${num}`)
      add(`${abbr}${num}`)
    }
    const mess = s.match(/\bM\s*(\d{1,3})\b/i) ?? s.match(/\bMessier\s+(\d{1,3})\b/i)
    if (mess) {
      const n = mess[1]!
      add(`M ${n}`)
      add(`M${n}`)
    }
    const dark = s.match(/\b(LDN|LBN|B|Barnard|Sh2)\s*-?\s*(\d{1,5})\b/i)
    if (dark) {
      const rawCat = dark[1]!.toUpperCase()
      const cat = rawCat === 'BARNARD' ? 'B' : rawCat === 'SH2' ? 'Sh2' : rawCat
      const num = dark[2]!
      add(`${cat} ${num}`)
      add(`${cat}${num}`)
    }
  }
  return Array.from(out)
}
