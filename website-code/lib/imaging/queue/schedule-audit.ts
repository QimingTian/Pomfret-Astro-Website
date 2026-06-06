import type { ImagingProject } from '@/lib/imaging-project-store'
import type { ImagingRequest, ImagingRequestStatus } from '@/lib/imaging-queue-store'
import {
  logSessionImagingPlanChanged,
  logSessionStatusChange,
  queueStatusToAuditStatus,
} from '@/lib/imaging/session/status-audit'

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

/** Audit log for single-night queue rows after reconcile (not multi-night project parents). */
export async function logQueueScheduleInsightChange(input: {
  row: Pick<ImagingRequest, 'id' | 'target' | 'projectMode' | 'status' | 'plannedStartIso'>
  previousQueueStatus: ImagingRequestStatus
  next: ScheduleInsightLike
  previousPlannedStartIso?: string | null
  nightIndex?: number | null
  nightSubId?: string | null
}): Promise<void> {
  if (input.row.projectMode === true) return

  const previousStatus = queueStatusToAuditStatus(input.previousQueueStatus)
  const nextStatus = input.next.status === 'scheduled' ? 'scheduled' : 'pending'
  const previousPlannedStartIso = input.previousPlannedStartIso ?? input.row.plannedStartIso ?? null
  const plannedStartIso = input.next.plannedStartIso

  const subject = {
    id: input.row.id,
    target: input.row.target,
    projectMode: false as const,
    ...(input.nightSubId ? { nightSubId: input.nightSubId } : {}),
    ...(input.nightIndex != null ? { nightIndex: input.nightIndex } : {}),
  }

  if (previousStatus !== nextStatus) {
    await logSessionStatusChange({
      subject,
      previousStatus,
      nextStatus,
      reasons: input.next.reasons,
      previousPlannedStartIso,
      plannedStartIso,
      source: 'reconcile',
    })
    return
  }

  if (nextStatus === 'scheduled' && previousPlannedStartIso !== plannedStartIso) {
    await logSessionImagingPlanChanged({
      subject,
      previousPlannedStartIso,
      plannedStartIso,
      reasons: input.next.reasons,
      source: 'reconcile',
    })
  }
}
