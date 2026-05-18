import { appendAuditLog } from '@/lib/imaging-audit-log'
import { getScheduleReservedIntervalsForActiveProject } from '@/lib/imaging-project-altitude-hold'
import { reconcileProjectSchedules } from '@/lib/imaging-project-planner'
import {
  collectTonightProjectSubSessionOccupancy,
  listProjects,
} from '@/lib/imaging-project-store'
import { computeScheduleInsight } from '@/lib/imaging-queue-schedule-insight'
import { listPending, patchRequestScheduleInsight, type ImagingRequest } from '@/lib/imaging-queue-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { getTonightWeatherPermittedIntervals, type TimeInterval } from '@/lib/tonight-weather-gate'

/**
 * Recompute `scheduleStatus` / `plannedStartIso` for all pending imaging requests from weather + queue rules.
 * Uses the same `computeScheduleInsight` as POST `/api/imaging/queue` so cron/current-sessions never diverges.
 * Safe to call frequently (cron, current-sessions GET). No-op when queue is empty.
 */
export async function reconcilePendingScheduleStatus(): Promise<void> {
  const pending = await listPending()

  const weatherIntervals = await getTonightWeatherPermittedIntervals()
  const now = new Date()
  const window = getTonightSchedulingWindow(now)
  const nowMs = now.getTime()
  let freeIntervals: Array<{ startMs: number; endMs: number }> = [
    {
      startMs: Math.max(nowMs, window.nauticalDuskUtc.getTime()),
      endMs: window.nauticalDawnUtc.getTime(),
    },
  ]

  if (weatherIntervals.status === 'ok') {
    await reconcileProjectSchedules(freeIntervals, weatherIntervals.permittedIntervals, now)
  }

  if (pending.length === 0) return

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
    const reservedIntervals = await getScheduleReservedIntervalsForActiveProject(now)
    const strip = getTonightScheduleStrip(now)
    const projectSubSessions = collectTonightProjectSubSessionOccupancy(
      await listProjects(),
      strip.nightKey,
      window.nauticalDuskUtc.getTime(),
      window.nauticalDawnUtc.getTime()
    )
    let working: ImagingRequest[] = pending.map((p) => ({ ...p }))

    for (const r of orderedBySubmission) {
      if (r.projectMode) {
        continue
      }

      const slice = working.map((p) =>
        p.id === r.id ? { ...p, status: 'pending' as const, plannedStartIso: null } : p
      )
      const insight = computeScheduleInsight(slice, r.id, permitted, {
        reservedIntervals,
        projectSubSessions,
      })
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
