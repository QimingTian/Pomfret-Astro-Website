import { appendAuditLog } from '@/lib/imaging-audit-log'
import { sendCompletionEmail, sendSessionFailedEmail } from '@/lib/imaging-completion-email'

export type ProjectNightMailContext = {
  queueId: string
  target: string
  email?: string | null
  firstName?: string | null
}

/** Completion email for one project sub-session (`{projectId}::night-N`). */
export function notifyProjectNightCompletionEmail(
  ctx: ProjectNightMailContext,
  completedAtIso: string
): void {
  void sendCompletionEmail({ ...ctx, completedAtIso }).then((result) => {
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
  void sendSessionFailedEmail({ ...ctx, failedAtIso }).then((result) => {
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
