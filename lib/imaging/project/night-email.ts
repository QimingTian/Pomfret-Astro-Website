import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendCompletionEmail, sendSessionFailedEmail } from '@/lib/imaging-completion-email'
import { projectSessionDisplayLabel } from '@/lib/imaging/project/session-display-label'
import { projectFilterFrameProgress } from '@/lib/imaging-total-frames'
import type { ImagingProject, ProjectNight } from '@/lib/imaging-project-store'

export type ProjectNightMailContext = {
  queueId: string
  target: string
  email?: string | null
  firstName?: string | null
  filterProgressLines?: string[]
  projectFinished?: boolean
}

/** Email/subject label: `{project}'s Session N` (mosaic: `Session P-S`). */
export function projectSubSessionEmailTarget(
  projectTarget: string,
  night: Pick<ProjectNight, 'nightIndex' | 'mosaicPanelIndex' | 'mosaicSubIndex'>
): string {
  return `${projectTarget}'s ${projectSessionDisplayLabel(night)}`
}

/** Lines like `Ha -- 250/300` from current project totals vs remaining. */
export function projectFilterProgressEmailLines(
  project: Parameters<typeof projectFilterFrameProgress>[0]
): string[] {
  return projectFilterFrameProgress(project).map(
    (row) => `${row.filterName} -- ${row.captured}/${row.total}`
  )
}

export function projectNightMailContext(
  project: Pick<ImagingProject, 'target' | 'email' | 'firstName'>,
  night: Pick<ProjectNight, 'id' | 'nightIndex' | 'mosaicPanelIndex' | 'mosaicSubIndex'>,
  extras?: {
    filterProgressLines?: string[]
    projectFinished?: boolean
  }
): ProjectNightMailContext {
  return {
    queueId: night.id,
    target: projectSubSessionEmailTarget(project.target, night),
    email: project.email,
    firstName: project.firstName,
    ...(extras?.filterProgressLines ? { filterProgressLines: extras.filterProgressLines } : {}),
    ...(extras?.projectFinished ? { projectFinished: true } : {}),
  }
}

/** Completion email for one project sub-session (`{projectId}::night-N`). */
export function notifyProjectNightCompletionEmail(
  ctx: ProjectNightMailContext,
  completedAtIso: string
): void {
  void sendCompletionEmail({
    queueId: ctx.queueId,
    target: ctx.target,
    email: ctx.email,
    firstName: ctx.firstName,
    completedAtIso,
    filterProgressLines: ctx.filterProgressLines,
    projectFinished: ctx.projectFinished,
  }).then((result) => {
    if (!result.sent) {
      return appendAuditLog({
        kind: 'session.progress',
        message: `Completion email skipped/failed for ${ctx.queueId}: ${result.reason ?? 'unknown reason'}`,
        detail: { queueId: ctx.queueId, reason: result.reason ?? null },
      })
    }
    return appendAuditLog({
      kind: 'session.progress',
      message: `Completion email sent for ${ctx.queueId}.`,
      detail: { queueId: ctx.queueId, email: ctx.email ?? null },
    })
  })
}

/** Failure email for one project sub-session (`{projectId}::night-N`). */
export function notifyProjectNightFailedEmail(
  ctx: ProjectNightMailContext,
  failedAtIso: string
): void {
  void sendSessionFailedEmail({
    queueId: ctx.queueId,
    target: ctx.target,
    email: ctx.email,
    firstName: ctx.firstName,
    failedAtIso,
  }).then((result) => {
    if (!result.sent) {
      return appendAuditLog({
        kind: 'session.progress',
        message: `Failure email skipped/failed for ${ctx.queueId}: ${result.reason ?? 'unknown reason'}`,
        detail: { queueId: ctx.queueId, reason: result.reason ?? null },
      })
    }
    return appendAuditLog({
      kind: 'session.progress',
      message: `Failure email sent for ${ctx.queueId}.`,
      detail: { queueId: ctx.queueId, email: ctx.email ?? null },
    })
  })
}
