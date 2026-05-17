import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { projectNightSubId } from '@/lib/imaging-project-ids'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import type { ScheduleBarPlacement } from '@/lib/imaging-schedule-bar'

export type ProjectStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'failed'
export type ProjectNightStatus = 'planned' | 'scheduled' | 'in_progress' | 'completed' | 'failed'

export type FilterPlanRow = { filterName: string; exposureSeconds: number; count: number }
export type FilterRemainingRow = {
  filterName: string
  exposureSeconds: number
  countRemaining: number
}

/** One imaging chunk (sub-session); `nightIndex` is a global session number across the project. */
export type ProjectNight = {
  id: string
  nightKey: string
  nightIndex: number
  status: ProjectNightStatus
  filterPlansTonight: FilterPlanRow[]
  ninaSequenceJson?: string
  plannedStartIso?: string | null
  completedAt?: string
  failedAt?: string
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
}

export type ImagingProject = {
  id: string
  projectMode: true
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  target: string
  raHours: number
  decDeg: number
  outputMode: 'raw_zip' | 'stacked_master' | 'none'
  filterPlansTotal: FilterPlanRow[]
  remainingByFilter: FilterRemainingRow[]
  nights: ProjectNight[]
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sessionPasswordHash?: string
  estimatedDurationSeconds?: number
  /** Set after first NINA consume; queue row is removed. */
  onBoard?: boolean
}

const KEY = 'imaging-projects'
const MAX_PROJECTS = 50

type Payload = { projects?: ImagingProject[] }

type GlobalWithProjects = typeof globalThis & {
  __pomfret_imaging_projects__?: ImagingProject[]
}

function memoryProjects(): ImagingProject[] {
  const g = globalThis as GlobalWithProjects
  if (!g.__pomfret_imaging_projects__) g.__pomfret_imaging_projects__ = []
  return g.__pomfret_imaging_projects__
}

function normalizeProjects(raw: unknown): ImagingProject[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as Payload).projects
  if (!Array.isArray(list)) return []
  return list.filter(
    (p): p is ImagingProject =>
      p != null &&
      typeof p === 'object' &&
      p.projectMode === true &&
      typeof (p as ImagingProject).id === 'string' &&
      typeof (p as ImagingProject).target === 'string'
  )
}

async function readProjects(): Promise<ImagingProject[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    return normalizeProjects(remote)
  }
  return [...memoryProjects()]
}

async function writeProjects(projects: ImagingProject[]): Promise<void> {
  const trimmed = projects.length > MAX_PROJECTS ? projects.slice(-MAX_PROJECTS) : projects
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { projects: trimmed })
    if (ok) return
  }
  const g = globalThis as GlobalWithProjects
  g.__pomfret_imaging_projects__ = trimmed
}

/** Remove duplicate strip-night rows left by older reconcile bugs. */
export async function compactStaleProjectNights(): Promise<void> {
  const all = await readProjects()
  let changed = false
  const next = all.map((p) => {
    const deduped = dedupeProjectNights(p.nights)
    if (deduped.length < p.nights.length) changed = true
    return { ...p, nights: deduped }
  })
  if (changed) await writeProjects(next)
}

export async function listProjects(): Promise<ImagingProject[]> {
  const all = await readProjects()
  return all
    .map((p) => ({ ...p, nights: dedupeProjectNights(p.nights) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getProjectById(id: string): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const project = all.find((p) => p.id === id)
  if (!project) return undefined
  return { ...project, nights: dedupeProjectNights(project.nights) }
}

export async function getProjectByNightSubId(
  nightSubId: string
): Promise<{ project: ImagingProject; night: ProjectNight } | undefined> {
  const all = await readProjects()
  for (const project of all) {
    const night = project.nights.find((n) => n.id === nightSubId)
    if (night) return { project, night }
  }
  return undefined
}

export async function getActiveInProgressProject(): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const active = all
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => {
      if (a.onBoard && !b.onBoard) return -1
      if (!a.onBoard && b.onBoard) return 1
      return a.createdAt.localeCompare(b.createdAt)
    })
  return active[0]
}

/** The one multi-night project allowed to plan sub-sessions; blocks all others until it completes or fails. */
export async function getBlockingInProgressProject(
  exceptProjectId?: string
): Promise<ImagingProject | undefined> {
  const active = await getActiveInProgressProject()
  if (!active) return undefined
  if (exceptProjectId && active.id === exceptProjectId) return undefined
  return active
}

export function projectSchedulingBlockedReason(blocker: ImagingProject): string {
  return `Waiting for multi-night project "${blocker.target}" to complete before this project can be scheduled.`
}

export function projectQueueBlockedReason(earlier: ImagingProject): string {
  return `Waiting for an earlier multi-night project in the queue ("${earlier.target}") to complete before this project can be scheduled.`
}

/** First pending project by submission time that may receive tonight's sub-session plans. */
export function getNextPendingProject(projects: ImagingProject[]): ImagingProject | undefined {
  return projects
    .filter((p) => p.status === 'pending' && remainingFramesTotal(p) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}

/** Project that has started imaging (first night delivered to NINA). */
export async function getActiveOnBoardProject(): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  return all.find((p) => p.status === 'in_progress' && p.onBoard === true)
}

/** True while this strip night still has a project night to shoot (not completed). */
export function projectHasOpenSessionsForNightKey(project: ImagingProject, nightKey: string): boolean {
  return project.nights.some(
    (n) =>
      n.nightKey === nightKey && (n.status === 'scheduled' || n.status === 'in_progress')
  )
}

export async function hasBlockingInProgressProject(exceptProjectId?: string): Promise<boolean> {
  const active = await getBlockingInProgressProject(exceptProjectId)
  return active != null
}

export function remainingFramesTotal(project: ImagingProject): number {
  return project.remainingByFilter.reduce((sum, r) => sum + Math.max(0, r.countRemaining), 0)
}

/** UI / API status mirrors the project store (only one project may be `in_progress` at a time). */
export function effectiveProjectStatus(project: ImagingProject): ProjectStatus {
  return project.status
}

export type CreateImagingProjectInput = {
  id: string
  target: string
  raHours: number
  decDeg: number
  outputMode: 'raw_zip' | 'stacked_master' | 'none'
  filterPlans: FilterPlanRow[]
  estimatedDurationSeconds: number
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sessionPasswordHash: string
}

export async function createImagingProject(input: CreateImagingProjectInput): Promise<ImagingProject> {
  const ts = new Date().toISOString()
  const remainingByFilter: FilterRemainingRow[] = input.filterPlans.map((p) => ({
    filterName: p.filterName,
    exposureSeconds: p.exposureSeconds,
    countRemaining: p.count,
  }))
  const project: ImagingProject = {
    id: input.id,
    projectMode: true,
    createdAt: ts,
    updatedAt: ts,
    status: 'pending',
    target: input.target,
    raHours: input.raHours,
    decDeg: input.decDeg,
    outputMode: input.outputMode,
    filterPlansTotal: input.filterPlans.map((p) => ({ ...p })),
    remainingByFilter,
    nights: [],
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    sessionPasswordHash: input.sessionPasswordHash,
    estimatedDurationSeconds: input.estimatedDurationSeconds,
    onBoard: false,
  }
  const all = await readProjects()
  const without = all.filter((p) => p.id !== project.id)
  await writeProjects([...without, project])
  return project
}

export async function patchProject(
  id: string,
  patch: Partial<
    Pick<
      ImagingProject,
      | 'status'
      | 'nights'
      | 'remainingByFilter'
      | 'onBoard'
      | 'updatedAt'
    >
  >
): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const idx = all.findIndex((p) => p.id === id)
  if (idx === -1) return undefined
  const next: ImagingProject = {
    ...all[idx]!,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  }
  const updated = [...all]
  updated[idx] = {
    ...next,
    nights: next.nights?.length ? dedupeProjectNights(next.nights) : next.nights,
  }
  await writeProjects(updated)
  return updated[idx]
}

export function buildNightNinaJson(
  project: ImagingProject,
  nightId: string,
  filterPlansTonight: FilterPlanRow[]
): string {
  const first = filterPlansTonight[0]
  if (!first) throw new Error('No filter plans for tonight')
  return buildNinaSequenceJson({
    raHoursDecimal: project.raHours,
    decDegDecimal: project.decDeg,
    filterName: first.filterName,
    exposureSeconds: first.exposureSeconds,
    exposureCount: first.count,
    pomfretQueueId: nightId,
    outputMode: project.outputMode,
    templateKind: 'dso',
    targetName: project.target,
    filterPlans: filterPlansTonight.map((p) => ({
      filterName: p.filterName,
      exposureSeconds: p.exposureSeconds,
      exposureCount: p.count,
    })),
  })
}

/** Collapse duplicate rows by stable sub-session id (reconcile spam). */
export function dedupeProjectNights(nights: ProjectNight[]): ProjectNight[] {
  const rank: Record<ProjectNightStatus, number> = {
    in_progress: 5,
    scheduled: 4,
    planned: 3,
    failed: 2,
    completed: 1,
  }
  const byId = new Map<string, ProjectNight>()
  for (const n of nights) {
    const prev = byId.get(n.id)
    if (!prev) {
      byId.set(n.id, n)
      continue
    }
    const keep = rank[n.status] > rank[prev.status] ? n : prev
    byId.set(n.id, keep)
  }
  return Array.from(byId.values()).sort((a, b) => a.nightIndex - b.nightIndex)
}

export function nextProjectSessionIndex(project: ImagingProject): number {
  const nights = dedupeProjectNights(project.nights)
  if (nights.length === 0) return 1
  return Math.max(...nights.map((n) => n.nightIndex)) + 1
}

/** @deprecated Use nextProjectSessionIndex */
export function nextProjectNightIndex(project: ImagingProject): number {
  return nextProjectSessionIndex(project)
}

/** Open sub-session on this calendar night that can be refreshed (scheduled / failed). */
export function findRefreshableSession(
  project: ImagingProject,
  nightKey: string,
  sessionId?: string
): ProjectNight | undefined {
  const nights = dedupeProjectNights(project.nights)
  if (sessionId) {
    const hit = nights.find((n) => n.id === sessionId)
    if (hit && hit.nightKey === nightKey && (hit.status === 'scheduled' || hit.status === 'failed')) {
      return hit
    }
  }
  return nights.find(
    (n) =>
      n.nightKey === nightKey &&
      (n.status === 'scheduled' || n.status === 'failed' || n.status === 'planned')
  )
}

export function hasInProgressSessionTonight(project: ImagingProject, nightKey: string): boolean {
  return project.nights.some((n) => n.nightKey === nightKey && n.status === 'in_progress')
}

export async function upsertPlannedNight(
  projectId: string,
  night: Omit<ProjectNight, 'id'> & { id?: string }
): Promise<ImagingProject | undefined> {
  const project = await getProjectById(projectId)
  if (!project) return undefined
  const nightIndex = night.nightIndex
  const nightId = night.id ?? projectNightSubId(projectId, nightIndex)
  const fullNight: ProjectNight = { ...night, id: nightId, nightIndex, status: 'scheduled' }
  let nights = dedupeProjectNights([...project.nights])
  const idx = nights.findIndex((n) => n.id === nightId)
  if (idx >= 0) {
    const prev = nights[idx]!
    nights[idx] = {
      ...prev,
      ...fullNight,
      id: prev.id,
      nightIndex: prev.nightIndex,
    }
  } else {
    nights.push(fullNight)
  }
  nights = dedupeProjectNights(nights)
  nights.sort((a, b) => a.nightIndex - b.nightIndex)
  return patchProject(projectId, { nights })
}

/** Replace all `scheduled` sub-sessions for a calendar night (keeps in_progress / completed). */
export async function replaceScheduledSubsForNightKey(
  projectId: string,
  nightKey: string,
  subs: ProjectNight[]
): Promise<ImagingProject | undefined> {
  const project = await getProjectById(projectId)
  if (!project) return undefined
  const kept = dedupeProjectNights(project.nights).filter(
    (n) => n.nightKey !== nightKey || n.status !== 'scheduled'
  )
  const merged: ProjectNight[] = [
    ...kept,
    ...subs.map((s) => ({ ...s, nightKey, status: 'scheduled' as const })),
  ]
  const nights = dedupeProjectNights(merged).sort((a, b) => a.nightIndex - b.nightIndex)
  return patchProject(projectId, { nights })
}

export async function markProjectOnBoard(projectId: string): Promise<void> {
  await patchProject(projectId, { status: 'in_progress', onBoard: true })
}

export async function markNightInProgress(projectId: string, nightSubId: string): Promise<void> {
  const project = await getProjectById(projectId)
  if (!project) return
  const nights = project.nights.map((n) =>
    n.id === nightSubId
      ? { ...n, status: 'in_progress' as const }
      : n.status === 'in_progress'
        ? { ...n, status: 'scheduled' as const }
        : n
  )
  await patchProject(projectId, { status: 'in_progress', nights })
}

export async function markNightCompleted(
  projectId: string,
  nightSubId: string
): Promise<{ project: ImagingProject; projectCompleted: boolean } | undefined> {
  const project = await getProjectById(projectId)
  if (!project) return undefined
  const night = project.nights.find((n) => n.id === nightSubId)
  if (!night) return undefined

  const completedAt = new Date().toISOString()
  const remainingByFilter = project.remainingByFilter.map((r) => {
    const shot = night.filterPlansTonight.find((p) => p.filterName === r.filterName)
    if (!shot) return r
    return {
      ...r,
      countRemaining: Math.max(0, r.countRemaining - shot.count),
    }
  })

  const nights = project.nights.map((n) =>
    n.id === nightSubId ? { ...n, status: 'completed' as const, completedAt } : n
  )

  const framesLeft = remainingByFilter.reduce((s, r) => s + r.countRemaining, 0)
  const projectCompleted = framesLeft === 0
  const status: ProjectStatus = projectCompleted ? 'completed' : 'in_progress'

  const updated = await patchProject(projectId, {
    nights,
    remainingByFilter,
    status,
  })
  if (!updated) return undefined
  return { project: updated, projectCompleted }
}

export async function markNightFailed(projectId: string, nightSubId: string): Promise<void> {
  const project = await getProjectById(projectId)
  if (!project) return
  const failedAt = new Date().toISOString()
  const nights = project.nights.map((n) =>
    n.id === nightSubId ? { ...n, status: 'failed' as const, failedAt } : n
  )
  await patchProject(projectId, { nights, status: 'in_progress' })
}

export async function markProjectFailed(projectId: string): Promise<void> {
  await patchProject(projectId, { status: 'failed' })
}

export async function setNightScheduleBar(
  nightSubId: string,
  bar: ScheduleBarPlacement
): Promise<void> {
  const all = await readProjects()
  let changed = false
  const next = all.map((project) => {
    const nights = project.nights.map((n) => {
      if (n.id !== nightSubId) return n
      if (
        (n.status === 'completed' || n.status === 'failed') &&
        n.scheduleStripNightKey === bar.nightKey &&
        typeof n.scheduleBarStartMs === 'number' &&
        typeof n.scheduleBarEndMs === 'number'
      ) {
        return n
      }
      changed = true
      return {
        ...n,
        scheduleStripNightKey: bar.nightKey,
        scheduleBarStartMs: bar.startMs,
        scheduleBarEndMs: bar.endMs,
      }
    })
    return changed ? { ...project, nights, updatedAt: new Date().toISOString() } : project
  })
  if (changed) await writeProjects(next)
}

export function getDeliverableNight(project: ImagingProject): ProjectNight | undefined {
  const inProgress = project.nights.find((n) => n.status === 'in_progress')
  if (inProgress?.ninaSequenceJson) return inProgress
  const scheduled = project.nights
    .filter((n) => n.status === 'scheduled' && n.ninaSequenceJson)
    .sort((a, b) => {
      const ta = Date.parse(a.plannedStartIso ?? '')
      const tb = Date.parse(b.plannedStartIso ?? '')
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb
      return a.nightIndex - b.nightIndex
    })
  return scheduled[0]
}

export function tonightDurationSecondsFromPlans(plans: FilterPlanRow[]): number {
  if (plans.length === 0) return 0
  return plans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0) + 15 * 60
}
