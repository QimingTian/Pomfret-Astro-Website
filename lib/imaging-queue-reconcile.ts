import { appendAuditLog } from '@/lib/imaging-audit-log'
import { computeScheduleInsight } from '@/lib/imaging-queue-schedule-insight'
import { listPending, patchRequestScheduleInsight, type ImagingRequest } from '@/lib/imaging-queue-store'
import { getTonightWeatherPermittedIntervals, type TimeInterval } from '@/lib/tonight-weather-gate'

/**
 * Recompute `scheduleStatus` / `plannedStartIso` for all pending imaging requests from weather + queue rules.
 * Uses the same `computeScheduleInsight` as POST `/api/imaging/queue` so cron/current-sessions never diverges.
 * Safe to call frequently (cron, current-sessions GET). No-op when queue is empty.
 */
export async function reconcilePendingScheduleStatus(): Promise<void> {
  const pending = await listPending()
  if (pending.length === 0) return

  const weatherIntervals = await getTonightWeatherPermittedIntervals()
  const nextById = new Map<string, { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }>()

  if (weatherIntervals.status !== 'ok') {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'],
      })
    }
  } else if (weatherIntervals.globalHardBlocked === true) {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'],
      })
    }
  } else {
    const orderedBySubmission = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const permitted = weatherIntervals.permittedIntervals as TimeInterval[]
    let working: ImagingRequest[] = pending.map((p) => ({ ...p }))

    for (const r of orderedBySubmission) {
      const slice = working.map((p) =>
        p.id === r.id ? { ...p, status: 'pending' as const, plannedStartIso: null } : p
      )
      const insight = computeScheduleInsight(slice, r.id, permitted)
      nextById.set(r.id, insight)

      const idx = working.findIndex((w) => w.id === r.id)
      if (idx < 0) continue
      if (insight.status === 'scheduled' && insight.plannedStartIso) {
        working[idx] = {
          ...working[idx]!,
          status: 'scheduled',
          plannedStartIso: insight.plannedStartIso,
        }
      } else {
        working[idx] = {
          ...working[idx]!,
          status: 'pending',
          plannedStartIso: null,
        }
      }
    }
  }

  for (const r of pending) {
    const next = nextById.get(r.id)
    if (!next) continue
    const prevQueueStatus = r.status
    const prevPlanned = r.plannedStartIso ?? null
    const nextQueueStatus = next.status === 'scheduled' ? 'scheduled' : 'pending'
    if (prevQueueStatus === nextQueueStatus && prevPlanned === next.plannedStartIso) continue
    await patchRequestScheduleInsight(r.id, next)
    if (prevQueueStatus === 'scheduled' && next.status === 'unscheduled') {
      void appendAuditLog({
        kind: 'queue.schedule_decision',
        message: `Session ${r.id} moved from scheduled back to pending schedule state.`,
        detail: {
          id: r.id,
          target: r.target,
          previousStatus: prevQueueStatus,
          nextStatus: next.status,
          previousPlannedStartIso: prevPlanned,
          reason: next.reasons.length <= 1 ? (next.reasons[0] ?? 'No reason provided') : next.reasons.join(' | '),
          reasons: next.reasons,
        },
      })
    }
  }
}
