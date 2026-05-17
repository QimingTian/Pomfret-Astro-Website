/** Night sub-id for progress/audit routing: `{projectId}::night-{index}` (1-based index). */
export function projectNightSubId(projectId: string, nightIndex: number): string {
  return `${projectId}::night-${nightIndex}`
}

export function parseProjectNightSubId(
  id: string
): { projectId: string; nightIndex: number } | null {
  const idx = id.indexOf('::night-')
  if (idx < 1) return null
  const projectId = id.slice(0, idx)
  const nightPart = id.slice(idx + '::night-'.length)
  const nightIndex = Number.parseInt(nightPart, 10)
  if (!Number.isFinite(nightIndex) || nightIndex < 1) return null
  return { projectId, nightIndex }
}

export function isProjectNightSubId(id: string): boolean {
  return parseProjectNightSubId(id) != null
}
