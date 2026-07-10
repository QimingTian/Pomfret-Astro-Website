/** Queue row statuses that mean the observatory is actively imaging a member session. */
export function queueStatusIsImagingActive(status: string): boolean {
  return status === 'in_progress' || status === 'claimed'
}

type StatusRow = { status: string }
type ProjectImagingRow = { status: string; nights?: ReadonlyArray<StatusRow> }

function rowsIncludeImagingActive(rows: ReadonlyArray<StatusRow> | undefined): boolean {
  return rows?.some((row) => queueStatusIsImagingActive(row.status)) ?? false
}

/**
 * True when a real imaging session is active or the agent reports NINA is running.
 * Project-level `in_progress` alone does not count — multi-night projects stay
 * `in_progress` between nights / daytime; only a night (sub-session) does.
 */
export function computeSiteImagingActive(input: {
  queueRows: ReadonlyArray<StatusRow>
  boardRows?: ReadonlyArray<StatusRow>
  projects?: ReadonlyArray<ProjectImagingRow>
  ninaRunning: boolean
}): boolean {
  if (input.ninaRunning) return true
  if (rowsIncludeImagingActive(input.queueRows)) return true
  if (rowsIncludeImagingActive(input.boardRows)) return true
  if (input.projects?.some((project) => rowsIncludeImagingActive(project.nights))) {
    return true
  }
  return false
}
