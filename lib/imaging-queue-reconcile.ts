import { appendAuditLog } from '@/lib/imaging-audit-log'
import { projectAltitudeHoldIntervals } from '@/lib/imaging-project-altitude-hold'
import {
  plannerFreeIntervalsBehindInProgressProject,
  reconcileActiveInProgressProjectTonight,
  reconcileOneProjectTonight,
  subtractProjectTonightPlansFromFree,
} from '@/lib/imaging-project-planner'
import {
  collectTonightProjectSubSessionOccupancy,
  getProjectById,
  listProjects,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import {
  computeScheduleInsight,
  estimateDurationSeconds,
} from '@/lib/imaging-queue-schedule-insight'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import { listPending, patchRequestScheduleInsight, type ImagingRequest } from '@/lib/imaging-queue-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { getTonightWeatherPermittedIntervals, type TimeInterval } from '@/lib/tonight-weather-gate'

/**
 * Recompute schedule for all pending queue rows (normal + project) in strict submission order.
 * The earliest in-progress project reserves its target's ≥30° windows; everyone else shares the rest FIFO.
 */
export async function reconcilePendingScheduleStatus(): Promise<void> {
  const pending = await listPending()
  const weatherIntervals = await getTonightWeatherPermittedIntervals()
  const now = new Date()
  const window = getTonightSchedulingWindow(now)
  const nowMs = now.getTime()
  const windowStartMs = window.nauticalDuskUtc.getTime()
  const deadlineMs = window.nauticalDawnUtc.getTime()
  const fullNightFree: Array<{ startMs: number; endMs: number }> = [
    {
      startMs: Math.max(nowMs, windowStartMs),
      endMs: deadlineMs,
    },
  ]

  let activeProject: ImagingProject | undefined
  const strip = getTonightScheduleStrip(now)
  const nightKey = strip.nightKey

  if (weatherIntervals.status === 'ok') {
    activeProject = await reconcileActiveInProgressProjectTonight(
      fullNightFree,
      weatherIntervals.permittedIntervals,
      now
    )
  }

  const nextById = new Map<
    string,
    { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }
  >()

  if (pending.length === 0) return

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
    const permitted = weatherIntervals.permittedIntervals as TimeInterval[]
    const reservedIntervals = activeProject ? projectAltitudeHoldIntervals(activeProject, now) : []

    let fifoFree = activeProject
      ? plannerFreeIntervalsBehindInProgressProject(activeProject, fullNightFree, nightKey, now)
      : fullNightFree

    let projectSubSessions = collectTonightProjectSubSessionOccupancy(
      await listProjects(),
      nightKey,
      windowStartMs,
      deadlineMs
    )

    const orderedBySubmission = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let working: ImagingRequest[] = pending.map((p) => ({ ...p }))

    for (const r of orderedBySubmission) {
      if (r.projectMode) {
        if (activeProject && r.id === activeProject.id) continue
        const project = await getProjectById(r.id)
        if (!project || project.status !== 'pending') continue

        const plans = await reconcileOneProjectTonight(
          project,
          fifoFree,
          permitted,
          nightKey,
          now
        )
        const insight =
          plans.length > 0
            ? {
                status: 'scheduled' as const,
                plannedStartIso: plans[0]!.plannedStartIso,
                reasons: [
                  `Multi-night project: ${plans.length} session(s) tonight (${plans.reduce((s, p) => s + p.filterPlansTonight.reduce((t, f) => t + f.count, 0), 0)} frame(s)).`,
                ],
              }
            : {
                status: 'unscheduled' as const,
                plannedStartIso: null,
                reasons: ['Project could not be scheduled for tonight; will retry on a later night.'],
              }
        nextById.set(r.id, insight)

        fifoFree = subtractProjectTonightPlansFromFree(fifoFree, plans)
        projectSubSessions = collectTonightProjectSubSessionOccupancy(
          await listProjects(),
          nightKey,
          windowStartMs,
          deadlineMs
        )
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
        const startMs = Date.parse(insight.plannedStartIso)
        if (Number.isFinite(startMs)) {
          const durationSeconds = estimateDurationSeconds(working[idx]!)
          fifoFree = subtractOccupiedFromFree(fifoFree, {
            startMs,
            endMs: startMs + durationSeconds * 1000,
          })
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
