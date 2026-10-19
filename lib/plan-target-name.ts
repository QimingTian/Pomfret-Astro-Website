/** Stellarium Web object ids often include a catalog token, e.g. `NAME Sun`. */
export function formatPlanObjectName(id: string | null | undefined): string {
  const t = (id ?? '').trim()
  if (!t) return ''
  return t.replace(/^NAME\s+/i, '').trim()
}

/** Session name for Plan → Remote: searched or clicked target, otherwise blank. */
export function planSessionNameForRemote(input: {
  trackingName?: string | null
  selectionId?: string | null
}): string {
  const fromTrack = (input.trackingName ?? '').trim()
  if (fromTrack) return fromTrack
  return formatPlanObjectName(input.selectionId)
}
