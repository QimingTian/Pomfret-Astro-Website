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
  projectHasOpenSessionsForNightKey,
  replaceScheduledSubsForNightKey,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import {
  computeScheduleInsight,
  estimateDurationSeconds,
} from '@/lib/imaging-queue-schedule-insight'
import { subtractOccupiedFromFree } from '@/lib/imaging-queue-free-intervals'
import { listPending, patchRequestScheduleInsight, type ImagingRequest } from '@/lib/imaging-queue-store'
import {
  deriveQueueScheduleState,
  logQueueScheduleInsightChange,
} from '@/lib/imaging/queue/schedule-audit'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { isAdminForceRunActive } from '@/lib/imaging/admin-force-run'
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

  if (weatherIntervals.status === 'ok' && weatherIntervals.globalHardBlocked !== true) {
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

  async function clearTonightScheduledProjectSubs(clearReason: string): Promise<void> {
    const projects = await listProjects()
    await Promise.all(
      projects
        .filter((p) => p.nights.some((n) => n.nightKey === nightKey && n.status === 'scheduled'))
        .map((p) => replaceScheduledSubsForNightKey(p.id, nightKey, [], { clearReason }))
    )
  }

  if (weatherIntervals.status !== 'ok') {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'],
      })
    }
    await clearTonightScheduledProjectSubs(
      weatherIntervals.reason ?? 'Unable to evaluate tonight weather.'
    )
  } else if (weatherIntervals.globalHardBlocked === true) {
    for (const r of pending) {
      nextById.set(r.id, {
        status: 'unscheduled',
        plannedStartIso: null,
        reasons: [weatherIntervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'],
      })
    }
    await clearTonightScheduledProjectSubs(
      weatherIntervals.globalHardBlockReason ?? 'Tonight blocked by global weather trigger.'
    )
  } else {
    const permitted = weatherIntervals.permittedIntervals as TimeInterval[]
    const reservedIntervals = activeProject ? projectAltitudeHoldIntervals(activeProject, now) : []

    let fifoFree = fullNightFree
    if (activeProject && projectHasOpenSessionsForNightKey(activeProject, nightKey)) {
      fifoFree = plannerFreeIntervalsBehindInProgressProject(activeProject, fullNightFree, nightKey, now)
    }

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

        const { plans, insight } = await reconcileOneProjectTonight(
          project,
          fifoFree,
          permitted,
          nightKey,
          now
        )
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

      if (
        isAdminForceRunActive(r, nowMs) &&
        r.status === 'scheduled' &&
        r.plannedStartIso != null &&
        Number.isFinite(Date.parse(r.plannedStartIso))
      ) {
        nextById.set(r.id, {
          status: 'scheduled',
          plannedStartIso: r.plannedStartIso,
          reasons: ['Admin force-run in progress.'],
        })
        const startMs = Date.parse(r.plannedStartIso)
        const durationSeconds = estimateDurationSeconds(r)
        fifoFree = subtractOccupiedFromFree(fifoFree, {
          startMs,
          endMs: startMs + durationSeconds * 1000,
        })
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
    const project = r.projectMode ? await getProjectById(r.id) : null
    const previousScheduleState = deriveQueueScheduleState(r, project ?? undefined, nightKey)
    await patchRequestScheduleInsight(r.id, next)
    if (previousScheduleState !== next.status) {
      await logQueueScheduleInsightChange({
        row: r,
        previousState: previousScheduleState,
        next,
        previousPlannedStartIso: prevPlanned,
      })
    }
  }
}
