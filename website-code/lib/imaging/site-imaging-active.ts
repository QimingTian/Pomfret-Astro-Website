/** Queue row statuses that mean the observatory is actively imaging a member session. */
export function queueStatusIsImagingActive(status: string): boolean {
  return status === 'in_progress' || status === 'claimed'
}

type StatusRow = { status: string }
type ProjectImagingRow = { status: string; nights?: ReadonlyArray<StatusRow> }

function rowsIncludeImagingActive(rows: ReadonlyArray<StatusRow> | undefined): boolean {
  return rows?.some((row) => queueStatusIsImagingActive(row.status)) ?? false
}

export type SiteImagingActiveInput = {
  queueRows: ReadonlyArray<StatusRow>
  boardRows?: ReadonlyArray<StatusRow>
  projects?: ReadonlyArray<ProjectImagingRow>
  ninaRunning: boolean
}

export type SiteImagingActiveReason =
  | 'nina_running'
  | 'queue_in_progress'
  | 'board_in_progress'
  | 'project_night_in_progress'

/**
 * True when a real imaging session is active or the agent reports NINA is running.
 * Project-level `in_progress` alone does not count — multi-night projects stay
 * `in_progress` between nights / daytime; only a night (sub-session) does.
 */
export function computeSiteImagingActive(input: SiteImagingActiveInput): boolean {
  return explainSiteImagingActive(input) != null
}

/** Why site imaging is considered active (first match), or null if idle. */
export function explainSiteImagingActive(
  input: SiteImagingActiveInput
): SiteImagingActiveReason | null {
  if (input.ninaRunning) return 'nina_running'
  if (rowsIncludeImagingActive(input.queueRows)) return 'queue_in_progress'
  if (rowsIncludeImagingActive(input.boardRows)) return 'board_in_progress'
  if (input.projects?.some((project) => rowsIncludeImagingActive(project.nights))) {
    return 'project_night_in_progress'
  }
  return null
}
