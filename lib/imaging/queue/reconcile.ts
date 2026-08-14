import { projectAltitudeHoldIntervals } from '@/lib/imaging-project-altitude-hold'
import {
  collectActiveAdminForceRunOccupancies,
  collectActiveAdminForceRunSubSessionOccupancy,
  isAdminForceRunActive,
  subtractAdminForceRunsFromFree,
} from '@/lib/imaging/admin-force-run'
import {
  plannerFreeIntervalsBehindInProgressProject,
  reconcileActiveInProgressProjectTonight,
  reconcileOneProjectTonight,
  subtractProjectTonightPlansFromFree,
} from '@/lib/imaging-project-planner'
import {
  collectTonightProjectSubSessionOccupancy,
  dropUndeliveredSubsBeforeNightKey,
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
import { logQueueScheduleInsightChange } from '@/lib/imaging/queue/schedule-audit'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { isEmergencyStopBlocking } from '@/lib/imaging-emergency-stop'
import { getTonightWeatherPermittedIntervals, type TimeInterval } from '@/lib/tonight-weather-gate'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

const RECONCILE_DEBOUNCE_KEY = 'imaging-reconcile-last-at'
/** Skip back-to-back full reconciles (SSE agent loop + overlapping serverless). */
const RECONCILE_DEBOUNCE_MS = 15_000

type GlobalWithReconcile = typeof globalThis & {
  __pomfret_last_reconcile_ms__?: number
}

async function reconcileRecentlyRan(force?: boolean): Promise<boolean> {
  if (force) return false
  const now = Date.now()
  if (kvEnabled()) {
    const remote = await kvGetJson<{ at: string }>(RECONCILE_DEBOUNCE_KEY)
    if (remote?.at) {
      const ms = Date.parse(remote.at)
      if (Number.isFinite(ms) && now - ms < RECONCILE_DEBOUNCE_MS) return true
    }
  } else {
    const last = (globalThis as GlobalWithReconcile).__pomfret_last_reconcile_ms__
    if (last != null && now - last < RECONCILE_DEBOUNCE_MS) return true
  }
  return false
}

async function markReconcileRan(): Promise<void> {
  const now = Date.now()
  if (kvEnabled()) {
    await kvSetJson(RECONCILE_DEBOUNCE_KEY, { at: new Date(now).toISOString() })
  }
  ;(globalThis as GlobalWithReconcile).__pomfret_last_reconcile_ms__ = now
}

export type ReconcileScheduleOptions = {
  /** Admin / explicit schedule mutations bypass the debounce window. */
  force?: boolean
}

/**
 * Recompute schedule for all pending queue rows (normal + project) in strict submission order.
 * Active admin force-run windows are subtracted from free time before any replanning so all
 * sessions (including in-progress project subs) schedule around them.
 */
export async function reconcilePendingScheduleStatus(options?: ReconcileScheduleOptions): Promise<void> {
  if (await reconcileRecentlyRan(options?.force)) return
  if (await isEmergencyStopBlocking()) return
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

  const strip = getTonightScheduleStrip(now)
  const nightKey = strip.nightKey
  await dropUndeliveredSubsBeforeNightKey(nightKey)

  const nextById = new Map<
    string,
    { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }
  >()

  // Do not return when pending is empty: multi-night projects whose queue row was
  // consumed after the first NINA delivery still need reconcileActiveInProgressProjectTonight.

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

    const forceRunOccupancy = await collectActiveAdminForceRunOccupancies(
      nightKey,
      windowStartMs,
      deadlineMs,
      nowMs
    )

    const fifoMinusForceRun = subtractAdminForceRunsFromFree(fullNightFree, forceRunOccupancy)

    const activeProject = await reconcileActiveInProgressProjectTonight(
      fifoMinusForceRun,
      permitted,
      now
    )

    const reservedIntervals = activeProject ? projectAltitudeHoldIntervals(activeProject, now) : []

    let fifoFree = fullNightFree
    if (activeProject && projectHasOpenSessionsForNightKey(activeProject, nightKey)) {
      fifoFree = plannerFreeIntervalsBehindInProgressProject(activeProject, fullNightFree, nightKey, now)
    }
    fifoFree = subtractAdminForceRunsFromFree(fifoFree, forceRunOccupancy)

    const forceRunSubOccupancy = await collectActiveAdminForceRunSubSessionOccupancy(
      windowStartMs,
      deadlineMs,
      nowMs
    )
    // Fresh store read after active reconcile — reserve any tonight project subs already
    // persisted (in-progress project Session N) before FIFO plans the next pending project.
    const projectsAfterActive = await listProjects()
    for (const occ of collectTonightProjectSubSessionOccupancy(
      projectsAfterActive,
      nightKey,
      windowStartMs,
      deadlineMs
    )) {
      fifoFree = subtractOccupiedFromFree(fifoFree, { startMs: occ.startMs, endMs: occ.endMs })
    }
    let projectSubSessions = [
      ...collectTonightProjectSubSessionOccupancy(
        projectsAfterActive,
        nightKey,
        windowStartMs,
        deadlineMs
      ),
      ...forceRunSubOccupancy,
    ]

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
        projectSubSessions = [
          ...collectTonightProjectSubSessionOccupancy(
            await listProjects(),
            nightKey,
            windowStartMs,
            deadlineMs
          ),
          ...forceRunSubOccupancy,
        ]
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
    await logQueueScheduleInsightChange({
      row: r,
      previousQueueStatus: prevQueueStatus,
      next,
      previousPlannedStartIso: prevPlanned,
    })
  }
  await markReconcileRan()
}
