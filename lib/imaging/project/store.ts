import { logSessionStatusChange, projectNightStatusToAuditStatus } from '@/lib/imaging/session/status-audit'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { projectNightSubId } from '@/lib/imaging-project-ids'
import { dsoSessionDurationSeconds } from '@/lib/imaging-session-overhead'
import { boardRemove, getBoardEntry, listBoardEntries } from '@/lib/imaging-session-board'
import { getRequestById } from '@/lib/imaging-queue-store'
import { emitSiteSessionsChanged } from '@/lib/imaging/site-events'
import { postgresReadsEnabled } from '@/lib/db'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import type { ScheduleBarPlacement } from '@/lib/imaging-schedule-bar'

export type ProjectStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'failed'
export type ProjectNightStatus = 'planned' | 'scheduled' | 'on_hold' | 'in_progress' | 'completed' | 'failed'

export type FilterPlanRow = { filterName: string; exposureSeconds: number; count: number }
export type FilterRemainingRow = {
  filterName: string
  exposureSeconds: number
  countRemaining: number
}

export type MosaicPanel = {
  id: number
  raHours: number
  decDeg: number
  positionAngleDeg: number
  name: string
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
  ninaDeliveredAt?: string
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
  adminForceRunUntilIso?: string | null
  onHoldFromStatus?: 'planned' | 'scheduled'
  /** Mosaic: panel number (1-based) for display Session {p}-{s}. */
  mosaicPanelIndex?: number
  mosaicSubIndex?: number
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
  cameraCoolingTempC?: number
  filterPlansTotal: FilterPlanRow[]
  remainingByFilter: FilterRemainingRow[]
  nights: ProjectNight[]
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sessionPasswordHash?: string
  userId?: string
  estimatedDurationSeconds?: number
  onBoard?: boolean
  completedAt?: string
  adminApprovalPending?: boolean
  mosaicMode?: boolean
  mosaicPanels?: MosaicPanel[]
  /** Original per-panel filter plans (parallel to mosaicPanels); UI progress totals. */
  mosaicFilterPlansByPanel?: FilterPlanRow[][]
  /** Per-panel filter progress (parallel to mosaicPanels). Enables cross-panel moon-aware scheduling. */
  mosaicRemainingByPanel?: FilterRemainingRow[][]
  /** @deprecated Mosaic interleaving uses mosaicRemainingByPanel; kept for legacy reads. */
  activePanelIndex?: number
}

export { projectSessionDisplayLabel } from '@/lib/imaging/project/session-display-label'

export function projectTargetCoordsForPanel(
  project: ImagingProject,
  panelIndex1Based: number,
): {
  raHours: number
  decDeg: number
  positionAngleDeg?: number
} {
  if (project.mosaicMode && project.mosaicPanels && project.mosaicPanels.length > 0) {
    const panelIdx = Math.max(0, Math.min(project.mosaicPanels.length - 1, panelIndex1Based - 1))
    const panel = project.mosaicPanels[panelIdx] ?? project.mosaicPanels[0]!
    return {
      raHours: panel.raHours,
      decDeg: panel.decDeg,
      positionAngleDeg: panel.positionAngleDeg,
    }
  }
  return { raHours: project.raHours, decDeg: project.decDeg }
}

export function projectTargetCoords(project: ImagingProject): {
  raHours: number
  decDeg: number
  positionAngleDeg?: number
} {
  if (project.mosaicMode && project.mosaicPanels && project.mosaicPanels.length > 0) {
    const firstOpen = firstMosaicPanelWithRemaining(project)
    if (firstOpen != null) return projectTargetCoordsForPanel(project, firstOpen)
    return projectTargetCoordsForPanel(project, 1)
  }
  return { raHours: project.raHours, decDeg: project.decDeg }
}

function cloneFilterRemaining(rows: FilterRemainingRow[]): FilterRemainingRow[] {
  return rows.map((r) => ({ ...r }))
}

function filterPlansToRemaining(plans: FilterPlanRow[]): FilterRemainingRow[] {
  return plans.map((p) => ({
    filterName: p.filterName,
    exposureSeconds: p.exposureSeconds,
    countRemaining: p.count,
  }))
}

/** Per-panel remaining rows; migrates legacy activePanelIndex + global remainingByFilter. */
export function ensureMosaicPanelRemaining(project: ImagingProject): FilterRemainingRow[][] {
  if (!project.mosaicMode || !project.mosaicPanels?.length) return []
  if (
    project.mosaicRemainingByPanel &&
    project.mosaicRemainingByPanel.length === project.mosaicPanels.length
  ) {
    return project.mosaicRemainingByPanel.map((rows) => cloneFilterRemaining(rows))
  }
  const active = project.activePanelIndex ?? 1
  return project.mosaicPanels.map((_, i) => {
    const panelNum = i + 1
    if (panelNum < active) {
      return filterPlansToRemaining(project.filterPlansTotal).map((r) => ({ ...r, countRemaining: 0 }))
    }
    if (panelNum === active) return cloneFilterRemaining(project.remainingByFilter)
    return filterPlansToRemaining(project.filterPlansTotal)
  })
}

export function remainingFramesForPanel(project: ImagingProject, panelIndex1Based: number): number {
  const rows = ensureMosaicPanelRemaining(project)[panelIndex1Based - 1]
  if (!rows) return 0
  return rows.reduce((s, r) => s + Math.max(0, r.countRemaining), 0)
}

export function firstMosaicPanelWithRemaining(project: ImagingProject): number | null {
  if (!project.mosaicMode || !project.mosaicPanels?.length) return null
  for (let i = 0; i < project.mosaicPanels.length; i++) {
    if (remainingFramesForPanel(project, i + 1) > 0) return i + 1
  }
  return null
}

export function sumRemainingByFilterAcrossPanels(
  panelRemaining: FilterRemainingRow[][],
): FilterRemainingRow[] {
  if (panelRemaining.length === 0) return []
  const byFilter = new Map<string, FilterRemainingRow>()
  for (const rows of panelRemaining) {
    for (const row of rows) {
      const prev = byFilter.get(row.filterName)
      if (!prev) {
        byFilter.set(row.filterName, {
          filterName: row.filterName,
          exposureSeconds: row.exposureSeconds,
          countRemaining: Math.max(0, row.countRemaining),
        })
      } else {
        prev.countRemaining += Math.max(0, row.countRemaining)
      }
    }
  }
  return Array.from(byFilter.values())
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
  if (postgresReadsEnabled()) {
    try {
      const { loadJsonDocumentsFromPostgres } = await import('@/lib/db/read')
      const pg = await loadJsonDocumentsFromPostgres<ImagingProject>('projects')
      if (pg) return pg
    } catch (error) {
      console.error('[pg-read] projects failed; using KV', error)
    }
  }
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    return normalizeProjects(remote)
  }
  return [...memoryProjects()]
}

function projectSessionsSignature(projects: ImagingProject[]): string {
  return projects
    .map((p) => {
      const nights = p.nights.map((n) => `${n.id}:${n.status}`).join(',')
      return `${p.id}:${p.status}:${nights}`
    })
    .join('|')
}

async function writeProjects(projects: ImagingProject[]): Promise<void> {
  const trimmed = projects.length > MAX_PROJECTS ? projects.slice(-MAX_PROJECTS) : projects
  const prevSig = projectSessionsSignature(memoryProjects())
  const nextSig = projectSessionsSignature(trimmed)
  if (postgresReadsEnabled()) {
    const { mirrorImagingProjects } = await import('@/lib/db/mirror')
    await mirrorImagingProjects(trimmed)
    const g = globalThis as GlobalWithProjects
    g.__pomfret_imaging_projects__ = trimmed
    if (prevSig !== nextSig) emitSiteSessionsChanged('projects')
    return
  }
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { projects: trimmed })
    if (ok) {
      const g = globalThis as GlobalWithProjects
      g.__pomfret_imaging_projects__ = trimmed
      const { mirrorImagingProjects } = await import('@/lib/db/mirror')
      await mirrorImagingProjects(trimmed)
      if (prevSig !== nextSig) emitSiteSessionsChanged('projects')
      return
    }
  }
  const g = globalThis as GlobalWithProjects
  g.__pomfret_imaging_projects__ = trimmed
  if (prevSig !== nextSig) emitSiteSessionsChanged('projects')
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

const STALE_UNDELIVERED_STATUSES = new Set<ProjectNightStatus>(['scheduled', 'planned', 'on_hold'])

function isForceRunStillActive(n: ProjectNight, nowMs: number): boolean {
  return (
    n.status === 'scheduled' &&
    n.adminForceRunUntilIso != null &&
    Number.isFinite(Date.parse(n.adminForceRunUntilIso)) &&
    Date.parse(n.adminForceRunUntilIso) > nowMs
  )
}

/** Undelivered row left on a previous strip night (not tonight's scheduled/planned/on_hold). */
export function isStaleUndeliveredNight(
  night: ProjectNight,
  currentNightKey: string,
  nowMs = Date.now()
): boolean {
  if (night.nightKey === currentNightKey) return false
  if (!STALE_UNDELIVERED_STATUSES.has(night.status)) return false
  if (isForceRunStillActive(night, nowMs)) return false
  return true
}

/** Drop leftover scheduled / planned / on_hold rows from previous nights. Frames stay in remainingByFilter. */
export async function dropUndeliveredSubsBeforeNightKey(currentNightKey: string): Promise<number> {
  if (!currentNightKey) return 0
  const all = await readProjects()
  const nowMs = Date.now()
  const dropped: Array<{ project: ImagingProject; night: ProjectNight }> = []
  const next = all.map((p) => {
    const stale = p.nights.filter((n) => isStaleUndeliveredNight(n, currentNightKey, nowMs))
    if (stale.length === 0) return p
    for (const night of stale) dropped.push({ project: p, night })
    return {
      ...p,
      nights: p.nights.filter((n) => !isStaleUndeliveredNight(n, currentNightKey, nowMs)),
    }
  })
  if (dropped.length === 0) return 0
  await writeProjects(next)
  for (const { project, night } of dropped) {
    await logSessionStatusChange({
      subject: {
        id: night.id,
        target: project.target,
        projectMode: true,
        projectId: project.id,
        nightSubId: night.id,
        nightIndex: night.nightIndex,
        nightKey: night.nightKey,
      },
      previousStatus: projectNightStatusToAuditStatus(night.status),
      nextStatus: 'pending',
      reason: `Dropped leftover ${night.status} sub from previous night ${night.nightKey}.`,
      previousPlannedStartIso: night.plannedStartIso ?? null,
      source: 'dropUndeliveredSubsBeforeNightKey',
    })
  }
  return dropped.length
}

/** Planned window end for a sub-session (planned start + duration, or frozen schedule bar end). */
export function projectSubSessionWindowEndMs(
  night: ProjectNight,
  opts?: { raHours?: number }
): number | null {
  if (night.plannedStartIso) {
    const startMs = Date.parse(night.plannedStartIso)
    if (Number.isFinite(startMs)) {
      return (
        startMs +
        tonightDurationSecondsFromPlans(night.filterPlansTonight, {
          startMs,
          raHours: opts?.raHours,
        }) *
          1000
      )
    }
  }
  if (typeof night.scheduleBarEndMs === 'number' && Number.isFinite(night.scheduleBarEndMs)) {
    return night.scheduleBarEndMs
  }
  return null
}

/** Drop on-board hold when tonight has no active or still-scheduled sub-session left. */
export async function releaseOnBoardProjectIfNothingDeliverable(
  projectId: string,
  stripNightKey: string
): Promise<void> {
  const project = await getProjectById(projectId)
  if (!project?.onBoard) return
  const matchesStrip = (n: ProjectNight) => !stripNightKey || n.nightKey === stripNightKey
  const stillTonight = project.nights.some(
    (n) => matchesStrip(n) && (n.status === 'in_progress' || n.status === 'scheduled')
  )
  if (stillTonight) return
  await patchProject(projectId, { onBoard: false })
}

/** True while this project is imaging or still has an undelivered sub tonight (altitude hold). */
export function projectHoldsQueueTonight(project: ImagingProject, stripNightKey: string): boolean {
  const matchesStrip = (n: ProjectNight) => !stripNightKey || n.nightKey === stripNightKey
  if (project.nights.some((n) => matchesStrip(n) && n.status === 'in_progress')) return true
  return getDeliverableNight(project, stripNightKey) != null
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

/** Project still tied to an operator-visible session (queue row or on-board after NINA consume). */
export async function isProjectVisibleToOperators(project: ImagingProject): Promise<boolean> {
  if (project.onBoard) return true
  if (project.status === 'in_progress' && remainingFramesTotal(project) > 0) return true
  if (await getRequestById(project.id)) return true
  const board = await getBoardEntry(project.id)
  return board?.projectMode === true
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

/** Remove imaging-project rows with no queue entry and not on board (e.g. after manual session delete). */
export async function compactOrphanProjects(): Promise<string[]> {
  const all = await readProjects()
  const removedIds: string[] = []
  const kept: ImagingProject[] = []
  for (const project of all) {
    if (await isProjectVisibleToOperators(project)) {
      kept.push(project)
      continue
    }
    removedIds.push(project.id)
  }
  if (removedIds.length > 0) {
    await writeProjects(kept)
    for (const id of removedIds) {
      await boardRemove(id)
    }
  }
  return removedIds
}

/** Board row left after project KV was removed (e.g. stale visibility cleanup). */
export async function compactStaleProjectBoardRows(): Promise<string[]> {
  const projectIds = new Set((await readProjects()).map((p) => p.id))
  const removed: string[] = []
  for (const entry of await listBoardEntries()) {
    if (entry.projectMode === true && !projectIds.has(entry.id)) {
      await boardRemove(entry.id)
      removed.push(entry.id)
    }
  }
  return removed
}

export async function deleteProjectById(id: string): Promise<boolean> {
  const all = await readProjects()
  const next = all.filter((p) => p.id !== id)
  if (next.length === all.length) return false
  await writeProjects(next)
  return true
}

/**
 * In-progress project that blocks others tonight. When `stripNightKey` is set, a project whose
 * remaining work is only on a later calendar strip night (e.g. Session 2 tomorrow) does not block.
 */
export async function getBlockingInProgressProject(
  exceptProjectId?: string,
  stripNightKey?: string
): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const candidates = all
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => {
      if (a.onBoard && !b.onBoard) return -1
      if (!a.onBoard && b.onBoard) return 1
      return a.createdAt.localeCompare(b.createdAt)
    })

  for (const project of candidates) {
    if (exceptProjectId && project.id === exceptProjectId) continue

    if (!(await isProjectVisibleToOperators(project))) {
      continue
    }

    if (remainingFramesTotal(project) <= 0) {
      await patchProject(project.id, { status: 'completed' })
      continue
    }

    if (stripNightKey && !projectHasOpenSessionsForNightKey(project, stripNightKey)) {
      continue
    }

    return project
  }

  return undefined
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
    .filter(
      (p) =>
        p.status === 'pending' &&
        remainingFramesTotal(p) > 0 &&
        p.adminApprovalPending !== true
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}

export async function setProjectAdminApprovalPending(
  id: string,
  pending: boolean
): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const idx = all.findIndex((p) => p.id === id)
  if (idx < 0) return undefined
  const ts = new Date().toISOString()
  const next: ImagingProject = {
    ...all[idx]!,
    updatedAt: ts,
    ...(pending ? { adminApprovalPending: true as const } : { adminApprovalPending: undefined }),
  }
  all[idx] = next
  await writeProjects(all)
  return next
}

export async function listProjectsAwaitingAdminApproval(): Promise<ImagingProject[]> {
  const all = await readProjects()
  return all
    .filter((p) => p.adminApprovalPending === true)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Project that has started imaging (at least one sub-session delivered to NINA). */
export async function getActiveOnBoardProject(): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  return all.find((p) => p.status === 'in_progress' && p.onBoard === true)
}

/**
 * In-progress project with a sub-session NINA can receive (on-board or not).
 * After the queue row is consumed, further sub-sessions deliver by sub-session id (same as any index).
 */
export async function getProjectAwaitingSubSessionDelivery(
  stripNightKey?: string
): Promise<ImagingProject | undefined> {
  const onBoard = await getActiveOnBoardProject()
  if (onBoard && getDeliverableNight(onBoard, stripNightKey)) return onBoard

  const candidates = (await readProjects())
    .filter((p) => p.status === 'in_progress' && remainingFramesTotal(p) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return candidates.find((p) => getDeliverableNight(p, stripNightKey) != null)
}

/** True while this strip night still has a project night to shoot (not completed). */
export function projectHasOpenSessionsForNightKey(project: ImagingProject, nightKey: string): boolean {
  return project.nights.some(
    (n) =>
      n.nightKey === nightKey && (n.status === 'scheduled' || n.status === 'in_progress')
  )
}

export async function hasBlockingInProgressProject(
  exceptProjectId?: string,
  stripNightKey?: string
): Promise<boolean> {
  const active = await getBlockingInProgressProject(exceptProjectId, stripNightKey)
  return active != null
}

export function remainingFramesTotal(project: ImagingProject): number {
  if (project.mosaicMode && project.mosaicPanels?.length) {
    return ensureMosaicPanelRemaining(project).reduce(
      (sum, rows) => sum + rows.reduce((s, r) => s + Math.max(0, r.countRemaining), 0),
      0,
    )
  }
  return project.remainingByFilter.reduce((sum, r) => sum + Math.max(0, r.countRemaining), 0)
}

/**
 * Status for member UI (Current Sessions, Session History).
 * Parent `project.status` can lag the queue row; sub-sessions and board state are authoritative.
 */
export function effectiveProjectStatus(project: ImagingProject): ProjectStatus {
  if (project.nights.some((n) => n.status === 'in_progress')) return 'in_progress'
  if (project.status === 'completed' && remainingFramesTotal(project) > 0) return 'in_progress'
  if (
    project.nights.some((n) => n.status === 'scheduled' && typeof n.plannedStartIso === 'string') &&
    (project.status === 'pending' || project.status === 'scheduled')
  ) {
    return 'scheduled'
  }
  return project.status
}

export type CreateImagingProjectInput = {
  id: string
  target: string
  raHours: number
  decDeg: number
  outputMode: 'raw_zip' | 'stacked_master' | 'none'
  cameraCoolingTempC?: number
  filterPlans: FilterPlanRow[]
  estimatedDurationSeconds: number
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sessionPasswordHash?: string
  userId?: string
  mosaicMode?: boolean
  mosaicPanels?: MosaicPanel[]
  /** Parallel to mosaicPanels — each panel may have its own filter/exposure plan. */
  mosaicFilterPlansByPanel?: FilterPlanRow[][]
}

function aggregateFilterPlansTotal(panelPlans: FilterPlanRow[][]): FilterPlanRow[] {
  const byKey = new Map<string, FilterPlanRow>()
  for (const plans of panelPlans) {
    for (const p of plans) {
      const key = `${p.filterName}\0${p.exposureSeconds}`
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, { ...p })
      } else {
        prev.count += p.count
      }
    }
  }
  return Array.from(byKey.values())
}

export async function createImagingProject(input: CreateImagingProjectInput): Promise<ImagingProject> {
  const ts = new Date().toISOString()
  const perPanelPlans =
    input.mosaicMode &&
    input.mosaicPanels?.length &&
    input.mosaicFilterPlansByPanel?.length === input.mosaicPanels.length
      ? input.mosaicFilterPlansByPanel
      : null
  const filterPlansTotal = perPanelPlans
    ? aggregateFilterPlansTotal(perPanelPlans)
    : input.filterPlans.map((p) => ({ ...p }))
  const remainingByFilter: FilterRemainingRow[] = filterPlansTotal.map((p) => ({
    filterName: p.filterName,
    exposureSeconds: p.exposureSeconds,
    countRemaining: p.count,
  }))
  const mosaicRemainingByPanel =
    input.mosaicMode && input.mosaicPanels?.length
      ? perPanelPlans
        ? perPanelPlans.map((plans) =>
            plans.map((p) => ({
              filterName: p.filterName,
              exposureSeconds: p.exposureSeconds,
              countRemaining: p.count,
            })),
          )
        : input.mosaicPanels.map(() => remainingByFilter.map((r) => ({ ...r })))
      : undefined
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
    ...(input.cameraCoolingTempC != null ? { cameraCoolingTempC: input.cameraCoolingTempC } : {}),
    filterPlansTotal,
    remainingByFilter: perPanelPlans
      ? sumRemainingByFilterAcrossPanels(mosaicRemainingByPanel ?? [])
      : remainingByFilter,
    nights: [],
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    ...(input.sessionPasswordHash ? { sessionPasswordHash: input.sessionPasswordHash } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    estimatedDurationSeconds: input.estimatedDurationSeconds,
    onBoard: false,
    ...(input.mosaicMode
      ? {
          mosaicMode: true,
          mosaicPanels: input.mosaicPanels,
          mosaicRemainingByPanel,
          ...(perPanelPlans
            ? {
                mosaicFilterPlansByPanel: perPanelPlans.map((plans) => plans.map((p) => ({ ...p }))),
              }
            : {}),
          activePanelIndex: 1,
        }
      : {}),
  }
  const all = await readProjects()
  const without = all.filter((p) => p.id !== project.id)
  await writeProjects([...without, project])
  return project
}

/** Sync project store after editing a pending Project Mode queue row (clears open sub-sessions). */
export async function applyPendingProjectQueueEdit(
  projectId: string,
  input: {
    target: string
    raHours: number
    decDeg: number
    outputMode: 'raw_zip' | 'stacked_master' | 'none'
    cameraCoolingTempC?: number
    filterPlans: FilterPlanRow[]
    estimatedDurationSeconds: number
    firstName: string | null
    lastName: string | null
    email: string | null
    sessionPasswordHash?: string
    mosaicMode?: boolean
    mosaicPanels?: MosaicPanel[]
    mosaicFilterPlansByPanel?: FilterPlanRow[][]
  }
): Promise<ImagingProject | { error: string }> {
  const project = await getProjectById(projectId)
  if (!project) return { error: 'Project not found' }
  if (!project.projectMode) return { error: 'Not a multi-night project' }
  if (project.status !== 'pending' && project.status !== 'scheduled') {
    return { error: "Project already started, can't edit session" }
  }
  if (project.nights.some((n) => n.status === 'in_progress')) {
    return { error: "Project already started, can't edit session" }
  }

  const ts = new Date().toISOString()
  const mosaicMode =
    input.mosaicMode === true &&
    Array.isArray(input.mosaicPanels) &&
    input.mosaicPanels.length > 0
  const perPanelPlans =
    mosaicMode &&
    input.mosaicFilterPlansByPanel?.length === input.mosaicPanels!.length
      ? input.mosaicFilterPlansByPanel
      : null
  const filterPlansTotal = perPanelPlans
    ? aggregateFilterPlansTotal(perPanelPlans)
    : input.filterPlans.map((p) => ({ ...p }))
  const remainingByFilter: FilterRemainingRow[] = filterPlansTotal.map((p) => ({
    filterName: p.filterName,
    exposureSeconds: p.exposureSeconds,
    countRemaining: p.count,
  }))
  const mosaicRemainingByPanel = mosaicMode
    ? perPanelPlans
      ? perPanelPlans.map((plans) =>
          plans.map((p) => ({
            filterName: p.filterName,
            exposureSeconds: p.exposureSeconds,
            countRemaining: p.count,
          })),
        )
      : input.mosaicPanels!.map(() => remainingByFilter.map((r) => ({ ...r })))
    : undefined
  // Keep terminal sub-sessions so Check Progress / history survive filter-plan edits.
  const nights = project.nights.filter(
    (n) => n.status === 'completed' || n.status === 'failed' || n.status === 'in_progress'
  )

  const next: ImagingProject = {
    ...project,
    status: 'pending',
    updatedAt: ts,
    target: input.target,
    raHours: input.raHours,
    decDeg: input.decDeg,
    outputMode: input.outputMode,
    ...(input.cameraCoolingTempC != null ? { cameraCoolingTempC: input.cameraCoolingTempC } : {}),
    filterPlansTotal,
    remainingByFilter: perPanelPlans
      ? sumRemainingByFilterAcrossPanels(mosaicRemainingByPanel ?? [])
      : remainingByFilter,
    estimatedDurationSeconds: input.estimatedDurationSeconds,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    nights,
    ...(input.sessionPasswordHash ? { sessionPasswordHash: input.sessionPasswordHash } : {}),
    ...(mosaicMode
      ? {
          mosaicMode: true,
          mosaicPanels: input.mosaicPanels,
          mosaicRemainingByPanel,
          ...(perPanelPlans
            ? {
                mosaicFilterPlansByPanel: perPanelPlans.map((plans) => plans.map((p) => ({ ...p }))),
              }
            : { mosaicFilterPlansByPanel: undefined }),
          activePanelIndex: 1,
        }
      : {
          mosaicMode: false,
          mosaicPanels: undefined,
          mosaicRemainingByPanel: undefined,
          mosaicFilterPlansByPanel: undefined,
          activePanelIndex: undefined,
        }),
  }
  const all = await readProjects()
  const idx = all.findIndex((p) => p.id === projectId)
  if (idx === -1) return { error: 'Project not found' }
  const updated = [...all]
  updated[idx] = next
  await writeProjects(updated)
  return next
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
      | 'completedAt'
      | 'activePanelIndex'
    >
  >
): Promise<ImagingProject | undefined> {
  const all = await readProjects()
  const idx = all.findIndex((p) => p.id === id)
  if (idx === -1) return undefined
  const prev = all[idx]!
  const ts = patch.updatedAt ?? new Date().toISOString()
  const status = patch.status ?? prev.status
  let completedAt = patch.completedAt ?? prev.completedAt
  if ((status === 'completed' || status === 'failed') && !completedAt) {
    completedAt = ts
  }
  const next: ImagingProject = {
    ...prev,
    ...patch,
    updatedAt: ts,
    ...(completedAt ? { completedAt } : {}),
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
  filterPlansTonight: FilterPlanRow[],
  mosaicPanelIndex?: number,
): string {
  const first = filterPlansTonight[0]
  if (!first) throw new Error('No filter plans for tonight')
  const coords =
    mosaicPanelIndex != null
      ? projectTargetCoordsForPanel(project, mosaicPanelIndex)
      : projectTargetCoords(project)
  return buildNinaSequenceJson({
    raHoursDecimal: coords.raHours,
    decDegDecimal: coords.decDeg,
    filterName: first.filterName,
    exposureSeconds: first.exposureSeconds,
    exposureCount: first.count,
    pomfretQueueId: nightId,
    outputMode: project.outputMode,
    cameraCoolingTempC: project.cameraCoolingTempC,
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
    on_hold: 4,
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

/** Replace tonight `scheduled` / `planned` sub-sessions (keeps in_progress / completed / failed / on_hold). */
export async function replaceScheduledSubsForNightKey(
  projectId: string,
  nightKey: string,
  subs: ProjectNight[],
  options?: { clearReason?: string }
): Promise<ImagingProject | undefined> {
  const project = await getProjectById(projectId)
  if (!project) return undefined
  const deduped = dedupeProjectNights(project.nights)
  const nowMs = Date.now()
  const isForceRunScheduled = (n: ProjectNight) =>
    n.nightKey === nightKey &&
    n.status === 'scheduled' &&
    n.adminForceRunUntilIso != null &&
    Number.isFinite(Date.parse(n.adminForceRunUntilIso)) &&
    Date.parse(n.adminForceRunUntilIso) > nowMs
  const isReplaceableTonightSub = (n: ProjectNight) =>
    n.nightKey === nightKey &&
    (n.status === 'scheduled' || n.status === 'planned') &&
    !isForceRunScheduled(n)
  const removed = deduped.filter(isReplaceableTonightSub)
  const kept = deduped.filter((n) => !isReplaceableTonightSub(n))
  const merged: ProjectNight[] = [
    ...kept,
    ...subs.map((s) => ({
      ...s,
      nightKey,
      status: s.status === 'on_hold' ? ('on_hold' as const) : ('scheduled' as const),
    })),
  ]
  const nights = dedupeProjectNights(merged).sort((a, b) => a.nightIndex - b.nightIndex)
  const updated = await patchProject(projectId, { nights })
  if (updated && removed.length > 0) {
    const reason =
      options?.clearReason ??
      (subs.length > 0
        ? 'Replaced by updated tonight sub-session plan.'
        : 'Tonight sub-session removed from schedule.')
    const rescheduledIds = new Set(subs.map((s) => s.id))
    for (const night of removed) {
      // Replacing a sub with an updated plan reuses the same id — skip noisy unscheduled lines.
      if (rescheduledIds.has(night.id)) continue
      await logSessionStatusChange({
        subject: {
          id: night.id,
          target: project.target,
          projectMode: true,
          projectId,
          nightSubId: night.id,
          nightIndex: night.nightIndex,
          nightKey,
        },
        previousStatus: projectNightStatusToAuditStatus(night.status),
        nextStatus: 'pending',
        reason,
        previousPlannedStartIso: night.plannedStartIso ?? null,
        source: 'replaceScheduledSubsForNightKey',
      })
    }
  }
  return updated
}

export async function markProjectOnBoard(projectId: string): Promise<void> {
  await patchProject(projectId, { status: 'in_progress', onBoard: true })
}

export async function markNightInProgress(projectId: string, nightSubId: string): Promise<void> {
  const project = await getProjectById(projectId)
  if (!project) return
  const deliveredAt = new Date().toISOString()
  const nights = project.nights.map((n) =>
    n.id === nightSubId
      ? {
          ...n,
          status: 'in_progress' as const,
          failedAt: undefined,
          ninaDeliveredAt: n.ninaDeliveredAt ?? deliveredAt,
        }
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
  const mosaicPanelIndex = night.mosaicPanelIndex

  let remainingByFilter = project.remainingByFilter.map((r) => {
    const shot = night.filterPlansTonight.find((p) => p.filterName === r.filterName)
    if (!shot) return r
    return {
      ...r,
      countRemaining: Math.max(0, r.countRemaining - shot.count),
    }
  })
  let mosaicRemainingByPanel = project.mosaicRemainingByPanel

  if (
    project.mosaicMode === true &&
    project.mosaicPanels &&
    project.mosaicPanels.length > 0 &&
    mosaicPanelIndex != null
  ) {
    const panelRem = ensureMosaicPanelRemaining(project)
    const pi = mosaicPanelIndex - 1
    if (panelRem[pi]) {
      panelRem[pi] = panelRem[pi]!.map((r) => {
        const shot = night.filterPlansTonight.find((p) => p.filterName === r.filterName)
        if (!shot) return r
        return {
          ...r,
          countRemaining: Math.max(0, r.countRemaining - shot.count),
        }
      })
    }
    mosaicRemainingByPanel = panelRem
    remainingByFilter = sumRemainingByFilterAcrossPanels(panelRem)
  }

  const nights = project.nights.map((n) =>
    n.id === nightSubId ? { ...n, status: 'completed' as const, completedAt } : n
  )

  const framesLeft = remainingFramesTotal({
    ...project,
    remainingByFilter,
    mosaicRemainingByPanel,
  })
  const projectCompleted = framesLeft === 0
  const nextRemaining = remainingByFilter

  const status: ProjectStatus = projectCompleted ? 'completed' : 'in_progress'

  const updated = await patchProject(projectId, {
    nights,
    remainingByFilter: nextRemaining,
    status,
    ...(project.mosaicMode ? { mosaicRemainingByPanel, activePanelIndex: firstMosaicPanelWithRemaining({ ...project, mosaicRemainingByPanel }) ?? project.activePanelIndex } : {}),
    ...(projectCompleted ? { completedAt, onBoard: false } : {}),
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

export async function removeProjectNight(projectId: string, nightSubId: string): Promise<boolean> {
  const project = await getProjectById(projectId)
  if (!project) return false
  const nights = dedupeProjectNights(project.nights).filter((n) => n.id !== nightSubId)
  if (nights.length === project.nights.length) return false
  await patchProject(projectId, { nights })
  return true
}

export async function markProjectFailed(projectId: string): Promise<void> {
  await patchProject(projectId, { status: 'failed', completedAt: new Date().toISOString() })
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

export function getDeliverableNight(
  project: ImagingProject,
  stripNightKey?: string
): ProjectNight | undefined {
  const matchesStrip = (n: ProjectNight) => !stripNightKey || n.nightKey === stripNightKey

  // Prefer undelivered subs. Delivered (`in_progress`) rows are handled by getRedeliverableInProgressNight.
  const scheduled = project.nights
    .filter((n) => n.status === 'scheduled' && n.ninaSequenceJson && matchesStrip(n))
    .sort((a, b) => {
      const ta = Date.parse(a.plannedStartIso ?? '')
      const tb = Date.parse(b.plannedStartIso ?? '')
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb
      return a.nightIndex - b.nightIndex
    })
  return scheduled[0]
}

/** Tonight sub-session marked in_progress after HTTP delivery but safe to offer JSON again (NINA not running). */
export function getRedeliverableInProgressNight(
  project: ImagingProject,
  stripNightKey?: string
): ProjectNight | undefined {
  const matchesStrip = (n: ProjectNight) => !stripNightKey || n.nightKey === stripNightKey
  const nights = project.nights
    .filter((n) => n.status === 'in_progress' && n.ninaSequenceJson && matchesStrip(n))
    .sort((a, b) => a.nightIndex - b.nightIndex)
  return nights[0]
}

export function getNightForNinaDelivery(
  project: ImagingProject,
  stripNightKey: string | undefined,
  options?: { allowRedeliverInProgress?: boolean }
): ProjectNight | undefined {
  return (
    getDeliverableNight(project, stripNightKey) ??
    (options?.allowRedeliverInProgress
      ? getRedeliverableInProgressNight(project, stripNightKey)
      : undefined)
  )
}

export type TonightDurationOpts = {
  /** Target RA (hours). With startMs, enables meridian-flip overhead. */
  raHours?: number
  /** Planned session start (ms). */
  startMs?: number
}

export function tonightDurationSecondsFromPlans(
  plans: FilterPlanRow[],
  opts?: TonightDurationOpts
): number {
  if (plans.length === 0) return 0
  return dsoSessionDurationSeconds({
    filterPlans: plans,
    raHours: opts?.raHours,
    startMs: opts?.startMs,
  })
}

/** Tonight sub-session windows used to block other queue rows (not full multi-night estimate). */
export type ProjectSubSessionOccupancy = {
  projectId: string
  target: string
  nightIndex: number
  startMs: number
  endMs: number
}

export function collectTonightProjectSubSessionOccupancy(
  projects: ImagingProject[],
  nightKey: string,
  windowStartMs: number,
  deadlineMs: number
): ProjectSubSessionOccupancy[] {
  const out: ProjectSubSessionOccupancy[] = []
  for (const project of projects) {
    if (project.status !== 'in_progress' && project.status !== 'scheduled') continue
    for (const night of project.nights) {
      if (night.nightKey !== nightKey) continue
      if (night.status !== 'scheduled' && night.status !== 'in_progress') continue
      if (!night.plannedStartIso) continue
      const startMs = Date.parse(night.plannedStartIso)
      if (!Number.isFinite(startMs)) continue
      const sky =
        night.mosaicPanelIndex != null
          ? projectTargetCoordsForPanel(project, night.mosaicPanelIndex)
          : projectTargetCoords(project)
      const durationSeconds = tonightDurationSecondsFromPlans(night.filterPlansTonight, {
        startMs,
        raHours: sky.raHours,
      })
      if (durationSeconds <= 0) continue
      const endMs = startMs + durationSeconds * 1000
      const overlapStart = Math.max(startMs, windowStartMs)
      const overlapEnd = Math.min(endMs, deadlineMs)
      if (overlapEnd <= overlapStart) continue
      out.push({
        projectId: project.id,
        target: project.target,
        nightIndex: night.nightIndex,
        startMs: overlapStart,
        endMs: overlapEnd,
      })
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}
