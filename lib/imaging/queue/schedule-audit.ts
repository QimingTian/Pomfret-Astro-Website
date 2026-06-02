import { appendAuditLog } from '@/lib/imaging-audit-log'
import type { ImagingProject } from '@/lib/imaging-project-store'
import type { ImagingRequest } from '@/lib/imaging-queue-store'

export type ScheduleDisplayState = 'scheduled' | 'unscheduled'

export type ScheduleInsightLike = {
  status: ScheduleDisplayState
  plannedStartIso: string | null
  reasons: string[]
}

function hasScheduledSubTonight(
  project: Pick<ImagingProject, 'nights'>,
  nightKey: string
): boolean {
  return project.nights.some(
    (n) =>
      n.nightKey === nightKey &&
      n.status === 'scheduled' &&
      typeof n.plannedStartIso === 'string' &&
      n.plannedStartIso.length > 0
  )
}

/** Whether the queue row / project has a tonight deliverable plan (includes in_progress parent + scheduled sub). */
export function deriveQueueScheduleState(
  row: Pick<ImagingRequest, 'status' | 'plannedStartIso' | 'projectMode'> | null | undefined,
  project?: Pick<ImagingProject, 'nights'> | null,
  nightKey?: string
): ScheduleDisplayState {
  if (row?.status === 'scheduled') return 'scheduled'
  if (project && nightKey && hasScheduledSubTonight(project, nightKey)) return 'scheduled'
  return 'unscheduled'
}

export async function logQueueScheduleInsightChange(input: {
  row: Pick<ImagingRequest, 'id' | 'target' | 'projectMode' | 'status' | 'plannedStartIso'>
  previousState: ScheduleDisplayState
  next: ScheduleInsightLike
  previousPlannedStartIso?: string | null
  nightIndex?: number | null
  nightSubId?: string | null
}): Promise<void> {
  const { row, previousState, next, previousPlannedStartIso = row.plannedStartIso ?? null } = input
  // Multi-night projects log sub-session changes in applyProjectTonightPlans / replaceScheduledSubsForNightKey.
  if (row.projectMode === true) return
  if (previousState === next.status) return
  if (
    previousState === 'scheduled' &&
    next.status === 'scheduled' &&
    previousPlannedStartIso != null &&
    next.plannedStartIso != null &&
    previousPlannedStartIso === next.plannedStartIso
  ) {
    return
  }

  await appendAuditLog({
    kind: 'session.schedule_changed',
    message: `Session schedule changed: ${row.target}${input.nightIndex != null ? ` Session ${input.nightIndex}` : ''} (${input.nightSubId ?? row.id}) ${previousState} -> ${next.status}.`,
    detail: {
      id: row.id,
      target: row.target,
      projectMode: false,
      ...(input.nightSubId ? { nightSubId: input.nightSubId } : {}),
      ...(input.nightIndex != null ? { nightIndex: input.nightIndex } : {}),
      previousStatus: previousState,
      nextStatus: next.status,
      previousPlannedStartIso,
      plannedStartIso: next.plannedStartIso,
      reason:
        next.reasons.length <= 1 ? (next.reasons[0] ?? 'No reason provided') : next.reasons.join(' | '),
      reasons: next.reasons,
    },
  })
}
