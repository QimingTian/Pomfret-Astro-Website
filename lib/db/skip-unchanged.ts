/** Cheap equality for skip-if-same Postgres upserts. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Persist project docs without NINA sequencer JSON. The JSON is rebuilt on load
 * from filter plans; rewriting 40–50KB blobs on every planner tick burned Neon transfer.
 */
export function stripNinaJsonFromProjectDocument(row: unknown): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(row)) as Record<string, unknown>
  if (!Array.isArray(doc.nights)) return doc
  doc.nights = doc.nights.map((night) => {
    if (!night || typeof night !== 'object' || Array.isArray(night)) return night
    const next = { ...(night as Record<string, unknown>) }
    delete next.ninaSequenceJson
    delete next.ninaSequenceJson
    return next
  })
  return doc
}
