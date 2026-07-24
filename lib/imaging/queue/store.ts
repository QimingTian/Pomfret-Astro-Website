import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'

import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import {
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  dsoSessionDurationSeconds,
} from '@/lib/imaging-session-overhead'
import { hashSessionPassword } from '@/lib/session-password'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import {
  emitAgentWakePollSequenceDebounced,
  emitSiteSessionsChanged,
  queueStatusSignature,
} from '@/lib/imaging/site-events'
import { getTonightAstronomicalNightWindow, getTonightSchedulingWindow } from '@/lib/sunrise-window'
import {
  altitudeAllowedCoverageMs,
  altitudeCoverageMsAtMinAltitude,
  altitudeSessionCoverageOk,
  firstAltitudeAllowedTimeMs,
  pomfretTargetObservabilityError,
  requiredAltitudeCoverageMs,
} from '@/lib/target-altitude'
import { allFiltersMoonOk } from '@/lib/moon-avoidance'
import { formatRaDecTargetLabel } from '@/lib/format-radec'

/** Queue lifecycle: mutually exclusive (no separate scheduleStatus flag). */
export type ImagingRequestStatus =
  | 'pending'
  | 'scheduled'
  | 'on_hold'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rejected'

export interface ImagingRequest {
  id: string
  createdAt: string
  updatedAt: string
  status: ImagingRequestStatus
  target: string
  raHours: number | null
  decDeg: number | null
  filter: string | null
  exposureSeconds: number
  count: number
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  cameraCoolingTempC?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  /** Estimated session duration in seconds: sum(filter count * exposure) + DSO overhead. */
  estimatedDurationSeconds?: number
  notes: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  /** Full NINA sequence JSON (only present for requests created after this feature). */
  ninaSequenceJson?: string
  sessionPasswordHash?: string
  /** @deprecated Migrated into `status === 'scheduled'`; stripped on load. */
  scheduleStatus?: 'scheduled' | 'unscheduled'
  plannedStartIso?: string | null
  scheduleReasons?: string[]
  sequenceTemplate?: 'dso' | 'variable_star'
  /** Multi-night DSO project; queue row is consumed on first NINA delivery only. */
  projectMode?: boolean
  mosaicMode?: boolean
  mosaicPanels?: Array<{
    id: number
    raHours: number
    decDeg: number
    positionAngleDeg: number
    name: string
  }>
  mosaicFilterPlansByPanel?: Array<Array<{ filterName: string; exposureSeconds: number; count: number }>>
  /** Member who submitted this session (new sessions). */
  userId?: string
  /** Large project mode (>30h total) awaiting admin approval before scheduling. */
  adminApprovalPending?: boolean
  /** Admin force-run: do not unschedule until this instant (ISO). */
  adminForceRunUntilIso?: string | null
  /** Status before admin placed this row on hold (restored on release). */
  onHoldFromStatus?: 'pending' | 'scheduled'
}

/** Strip large JSON from API list responses; expose download path instead. */
export function toPublicImagingRequest(
  r: ImagingRequest,
  options?: { redactContact?: boolean }
): Omit<ImagingRequest, 'ninaSequenceJson' | 'sessionPasswordHash' | 'scheduleStatus'> & {
  ninaSequencePath?: string
} {
  const { ninaSequenceJson, sessionPasswordHash, scheduleStatus: _legacySchedule, ...rest } = r
  const pub = {
    ...rest,
    ninaSequencePath: `/api/imaging/queue/${r.id}/nina-sequence`,
  }
  if (!options?.redactContact) return pub
  return {
    ...pub,
    email: undefined,
    firstName: undefined,
    lastName: undefined,
  }
}

const MAX_QUEUE = 100
const MAX_TARGET = 200
const MAX_FILTER = 64
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS = 600
const VARIABLE_STAR_ESTIMATE_ALTITUDE_DEG = 40
export {
  DSO_SESSION_OVERHEAD_SEC,
  DSO_MERIDIAN_FLIP_OVERHEAD_SEC,
  DSO_EXTRA_FILTER_OVERHEAD_SEC,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
  dsoSessionOverheadSeconds,
  dsoSessionDurationSeconds,
} from '@/lib/imaging-session-overhead'

function variableStarDurationFromClientEstimate(inputEst: unknown): { ok: true; seconds: number } | { ok: false } {
  if (typeof inputEst !== 'number' || !Number.isFinite(inputEst)) return { ok: false }
  const est = Math.round(inputEst)
  if (est < VARIABLE_STAR_SESSION_OVERHEAD_SEC + 30 * 60) return { ok: false }
  const blockSec = est - VARIABLE_STAR_SESSION_OVERHEAD_SEC
  const blockH = blockSec / 3600
  const halves = blockH * 2
  if (Math.abs(halves - Math.round(halves)) > 0.02) return { ok: false }
  if (blockH < 0.5 - 1e-6) return { ok: false }
  return { ok: true, seconds: Math.max(60, est) }
}

type GlobalWithQueue = typeof globalThis & { __pomfret_imaging_queue__?: ImagingRequest[] }

function getMemory(): ImagingRequest[] {
  const g = globalThis as GlobalWithQueue
  if (!g.__pomfret_imaging_queue__) g.__pomfret_imaging_queue__ = []
  return g.__pomfret_imaging_queue__
}

const queueFile = process.env.IMAGING_QUEUE_FILE

/** Shared across Vercel instances when Upstash KV is configured (same pattern as imaging-session-board). */
const KV_QUEUE_KEY = 'imaging-queue-requests'

let diskLoaded = false
let lastQueueStatusSignature = ''

type QueueFilePayload = { requests?: ImagingRequest[] }

async function loadQueueFromKvIntoMemory(): Promise<void> {
  const mem = getMemory()
  const remote = await kvGetJson<QueueFilePayload>(KV_QUEUE_KEY)
  const list = Array.isArray(remote?.requests) ? remote.requests : []
  mem.splice(0, mem.length, ...list.slice(-MAX_QUEUE))
  diskLoaded = true
}

async function ensureLoadedFromDisk(): Promise<void> {
  if (kvEnabled()) {
    await loadQueueFromKvIntoMemory()
  } else if (!queueFile || diskLoaded) {
    // no-op
  } else {
    diskLoaded = true
    const mem = getMemory()
    try {
      const raw = await readFile(queueFile, 'utf-8')
      const parsed = JSON.parse(raw) as { requests?: ImagingRequest[] }
      const list = Array.isArray(parsed.requests) ? parsed.requests : []
      mem.splice(0, mem.length, ...list.slice(-MAX_QUEUE))
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw e
    }
  }
  if (normalizeQueueInMemory()) {
    await persist()
  }
}

async function persist(): Promise<void> {
  const mem = getMemory()
  const snapshot = [...mem]
  const nextSig = queueStatusSignature(snapshot)
  const statusChanged = nextSig !== lastQueueStatusSignature
  if (kvEnabled()) {
    await kvSetJson(KV_QUEUE_KEY, { requests: snapshot })
    if (statusChanged) {
      lastQueueStatusSignature = nextSig
      emitSiteSessionsChanged('queue')
      emitAgentWakePollSequenceDebounced()
    }
    return
  }
  if (!queueFile) return
  await mkdir(path.dirname(queueFile), { recursive: true })
  const tmp = `${queueFile}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify({ requests: snapshot }, null, 2)
  await writeFile(tmp, payload, 'utf-8')
  await rename(tmp, queueFile)
  if (statusChanged) {
    lastQueueStatusSignature = nextSig
    emitSiteSessionsChanged('queue')
    emitAgentWakePollSequenceDebounced()
  }
}

function nowIso() {
  return new Date().toISOString()
}

/** One-time shape fix: legacy `pending` + `scheduleStatus` → unified `status`; drop `scheduleStatus`. */
function normalizeImagingRequest(r: ImagingRequest): ImagingRequest {
  let status: ImagingRequestStatus = r.status
  if (status === 'pending' && r.scheduleStatus === 'scheduled') {
    status = 'scheduled'
  }
  if ((r.status as string) === 'claimed') {
    status = 'in_progress'
  }
  const next: ImagingRequest = {
    ...r,
    status,
    plannedStartIso: r.plannedStartIso ?? null,
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  return next
}

function normalizeQueueInMemory(): boolean {
  const mem = getMemory()
  let dirty = false
  for (let i = 0; i < mem.length; i++) {
    const before = JSON.stringify(mem[i])
    mem[i] = normalizeImagingRequest(mem[i]!)
    if (before !== JSON.stringify(mem[i])) dirty = true
  }
  return dirty
}

export async function listAll(): Promise<ImagingRequest[]> {
  await ensureLoadedFromDisk()
  return [...getMemory()]
}

export async function listPending(): Promise<ImagingRequest[]> {
  const all = await listAll()
  return all
    .filter(
      (r) =>
        (r.status === 'pending' || r.status === 'scheduled') && r.adminApprovalPending !== true
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listQueueAwaitingAdminApproval(): Promise<ImagingRequest[]> {
  const all = await listAll()
  return all
    .filter((r) => r.adminApprovalPending === true && r.projectMode === true)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function setRequestAdminApprovalPending(
  id: string,
  pending: boolean
): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx < 0) return undefined
  const ts = new Date().toISOString()
  const next: ImagingRequest = {
    ...mem[idx]!,
    updatedAt: ts,
    ...(pending ? { adminApprovalPending: true as const } : { adminApprovalPending: undefined }),
  }
  mem[idx] = next
  await persist()
  return next
}

export async function getRequestById(id: string): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  return getMemory().find((r) => r.id === id)
}

export async function getLatestRequest(): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  if (mem.length === 0) return undefined
  return [...mem].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

export async function deleteRequestById(id: string): Promise<boolean> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return false
  mem.splice(idx, 1)
  await persist()
  return true
}

/** Returns and removes the latest request (download-and-delete semantics for NINA). */
export async function consumeLatestRequest(): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  if (mem.length === 0) return undefined

  const latest = [...mem].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const idx = mem.findIndex((r) => r.id === latest.id)
  if (idx === -1) return undefined
  const [removed] = mem.splice(idx, 1)
  await persist()
  return removed
}

/** Returns and removes a specific request by id. */
export async function consumeRequestById(id: string): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  const [removed] = mem.splice(idx, 1)
  await persist()
  return removed
}

export async function patchRequestScheduleInsight(
  id: string,
  insight: { status: 'scheduled' | 'unscheduled'; plannedStartIso: string | null; reasons: string[] }
): Promise<boolean> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return false
  const current = mem[idx]
  if (current.status === 'on_hold') {
    return true
  }
  const forceRunActive =
    current.adminForceRunUntilIso != null &&
    Number.isFinite(Date.parse(current.adminForceRunUntilIso)) &&
    Date.parse(current.adminForceRunUntilIso) > Date.now()
  if (forceRunActive && insight.status !== 'scheduled') {
    return true
  }
  const queueStatus: ImagingRequestStatus = insight.status === 'scheduled' ? 'scheduled' : 'pending'
  const next: ImagingRequest = {
    ...current,
    status: queueStatus,
    plannedStartIso: insight.plannedStartIso,
    scheduleReasons: insight.reasons,
    updatedAt: nowIso(),
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  mem[idx] = next
  await persist()
  return true
}

export async function patchRequestAdminForceRun(
  id: string,
  input: { plannedStartIso: string; adminForceRunUntilIso: string }
): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  const current = mem[idx]!
  const next: ImagingRequest = {
    ...current,
    status: 'scheduled',
    plannedStartIso: input.plannedStartIso,
    adminForceRunUntilIso: input.adminForceRunUntilIso,
    scheduleReasons: ['Admin force-run scheduled.'],
    updatedAt: nowIso(),
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  mem[idx] = next
  await persist()
  return next
}

export async function patchRequestOnHold(
  id: string,
  input: { fromStatus: 'pending' | 'scheduled' }
): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  const current = mem[idx]!
  const next: ImagingRequest = {
    ...current,
    status: 'on_hold',
    onHoldFromStatus: input.fromStatus,
    plannedStartIso: null,
    adminForceRunUntilIso: null,
    scheduleReasons: ['On hold by admin.'],
    updatedAt: nowIso(),
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  mem[idx] = next
  await persist()
  return next
}

export async function releaseRequestOnHold(id: string): Promise<ImagingRequest | undefined> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  const current = mem[idx]!
  if (current.status !== 'on_hold') return undefined
  /* Always pending — reconcile assigns a fresh scheduled slot (never keep a stale Scheduled). */
  const next: ImagingRequest = {
    ...current,
    status: 'pending',
    onHoldFromStatus: undefined,
    plannedStartIso: null,
    adminForceRunUntilIso: null,
    scheduleReasons: undefined,
    updatedAt: nowIso(),
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  mem[idx] = next
  await persist()
  return next
}

export interface CreateImagingInput {
  /** Optional display name; if empty, a label is derived from RA/Dec. */
  target?: string | null
  raHours: number | string
  decDeg: number | string
  filter: string | null
  exposureSeconds: number | string
  count: number | string
  sessionPassword?: string
  userId?: string
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  cameraCoolingTempC?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number | string; count: number | string }>
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sequenceTemplate?: 'dso' | 'variable_star'
  /** Variable star: total seconds = (N×0.5 h block) + variable-star session overhead; validated when `sequenceTemplate` is `variable_star`. */
  estimatedDurationSeconds?: number
  /** Multi-night DSO project: skip single-night duration / ideal-night feasibility checks. */
  projectMode?: boolean
  mosaicMode?: boolean
  mosaicPanels?: Array<{
    id: number
    raHours: number
    decDeg: number
    positionAngleDeg: number
    name: string
  }>
  /** Parallel to mosaicPanels when each panel has its own filter plan. */
  mosaicFilterPlansByPanel?: Array<Array<{ filterName: string; exposureSeconds: number; count: number }>>
}

function targetLabelFromCoords(raHours: number, decDeg: number): string {
  return formatRaDecTargetLabel(raHours, decDeg)
}

function canFitInIdealNight(
  raHours: number,
  decDeg: number,
  durationMs: number,
  windowStartMs: number,
  windowEndMs: number,
  moonFilterPlans?: Array<{ filterName: string }>
): boolean {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false
  if (windowEndMs - windowStartMs < durationMs) return false
  const latestStartMs = windowEndMs - durationMs
  const STEP_MS = 5 * 60 * 1000

  // Search possible starts under ideal conditions: no weather limits, no queue blockers.
  // Still enforce target >= 30deg for the full session duration (100% altitude coverage),
  // and — when filter plans are supplied — moon avoidance for every filter over the window.
  let cursor = windowStartMs
  while (cursor <= latestStartMs) {
    const startMs = firstAltitudeAllowedTimeMs(raHours, decDeg, cursor, latestStartMs)
    if (startMs == null) return false
    const endMs = startMs + durationMs
    if (endMs > windowEndMs) return false
    if (
      altitudeSessionCoverageOk(raHours, decDeg, startMs, endMs) &&
      (!moonFilterPlans?.length || allFiltersMoonOk(moonFilterPlans, raHours, decDeg, startMs, endMs))
    ) {
      return true
    }
    cursor = startMs + STEP_MS
  }
  return false
}

export async function createRequest(input: CreateImagingInput): Promise<ImagingRequest | { error: string }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()

  if (input.raHours == null || String(input.raHours).trim() === '') {
    return { error: 'RA is required' }
  }
  const raHours = Number(input.raHours)
  if (!Number.isFinite(raHours) || raHours < 0 || raHours >= 24) {
    return { error: 'RA (hours) must be between 0 and 24' }
  }

  if (input.decDeg == null || String(input.decDeg).trim() === '') {
    return { error: 'Dec is required' }
  }
  const decDeg = Number(input.decDeg)
  if (!Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90) {
    return { error: 'Dec (degrees) must be between -90 and 90' }
  }

  const mosaicModeEarly = input.sequenceTemplate !== 'variable_star' && input.mosaicMode === true
  if (mosaicModeEarly && Array.isArray(input.mosaicPanels) && input.mosaicPanels.length > 0) {
    for (const panel of input.mosaicPanels) {
      const panelDec = Number(panel.decDeg)
      if (!Number.isFinite(panelDec)) continue
      const obsErr = pomfretTargetObservabilityError(panelDec)
      if (obsErr) {
        const label = typeof panel.name === 'string' && panel.name.trim() ? panel.name.trim() : `Panel ${panel.id}`
        return { error: `${label}: ${obsErr}` }
      }
    }
  } else {
    const obsErr = pomfretTargetObservabilityError(decDeg)
    if (obsErr) return { error: obsErr }
  }

  const exposureSeconds = Math.round(Number(input.exposureSeconds))
  const count = Math.round(Number(input.count))

  const sequenceTemplate: 'dso' | 'variable_star' =
    input.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso'
  const mosaicMode = sequenceTemplate === 'dso' && input.mosaicMode === true
  const projectMode =
    sequenceTemplate === 'dso' && (input.projectMode === true || mosaicMode)
  const filterRaw =
    sequenceTemplate === 'variable_star'
      ? 'G'
      : input.filter == null
        ? ''
        : input.filter === ''
          ? ''
          : String(input.filter).trim().slice(0, MAX_FILTER)
  if (!filterRaw) {
    return { error: 'Filter is required' }
  }
  const filter = filterRaw
  const normalizedFilterPlans =
    sequenceTemplate === 'variable_star'
      ? [{ filterName: 'G', exposureSeconds, count }]
      : Array.isArray(input.filterPlans) && input.filterPlans.length > 0
      ? input.filterPlans
          .map((p) => {
            const filterName = typeof p.filterName === 'string' ? p.filterName.trim().slice(0, MAX_FILTER) : ''
            const exposure = Math.round(Number(p.exposureSeconds))
            const frames = Math.round(Number(p.count))
            return { filterName, exposureSeconds: exposure, count: frames }
          })
          .filter((p) => p.filterName !== '')
      : [{ filterName: filter, exposureSeconds, count }]

  if (normalizedFilterPlans.length === 0) {
    return { error: 'At least one filter plan is required' }
  }
  for (const plan of normalizedFilterPlans) {
    if (!Number.isFinite(plan.exposureSeconds) || plan.exposureSeconds < 1 || plan.exposureSeconds > 3600) {
      return { error: 'Exposure must be between 1 and 3600 seconds' }
    }
    if (!Number.isFinite(plan.count) || plan.count < 1) {
      return { error: 'Count must be at least 1' }
    }
  }

  const customTarget =
    input.target != null && String(input.target).trim() !== ''
      ? String(input.target).trim().slice(0, MAX_TARGET)
      : ''
  const target = customTarget || targetLabelFromCoords(raHours, decDeg)
  const firstName =
    typeof input.firstName === 'string' && input.firstName.trim()
      ? input.firstName.trim().slice(0, 80)
      : null
  const lastName =
    typeof input.lastName === 'string' && input.lastName.trim()
      ? input.lastName.trim().slice(0, 80)
      : null
  const email =
    typeof input.email === 'string' && input.email.trim()
      ? input.email.trim().slice(0, 200)
      : null
  if (!email) {
    return { error: 'Email is required' }
  }
  if (!EMAIL_REGEX.test(email)) {
    return { error: 'Invalid email format' }
  }

  const notes: string | null = null
  const outputMode: 'raw_zip' | 'stacked_master' | 'none' =
    input.outputMode === 'stacked_master'
      ? 'stacked_master'
      : input.outputMode === 'none'
        ? 'none'
        : 'raw_zip'
  if (
    outputMode === 'stacked_master' &&
    normalizedFilterPlans.some((p) => p.exposureSeconds !== STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS)
  ) {
    return { error: '600s is required for stacked master mode.' }
  }
  const id = crypto.randomUUID()
  const estimatedDurationSeconds =
    sequenceTemplate === 'variable_star'
      ? (() => {
          const custom = variableStarDurationFromClientEstimate(input.estimatedDurationSeconds)
          if (custom.ok) return custom.seconds
          return Math.max(
            0,
            Math.round(
              altitudeCoverageMsAtMinAltitude(
                raHours,
                decDeg,
                getTonightAstronomicalNightWindow(new Date()).astronomicalDuskUtc.getTime(),
                getTonightAstronomicalNightWindow(new Date()).astronomicalDawnUtc.getTime(),
                VARIABLE_STAR_ESTIMATE_ALTITUDE_DEG
              ) / 1000
            )
          )
        })()
      : dsoSessionDurationSeconds({ filterPlans: normalizedFilterPlans })

  if (!projectMode) {
    const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(new Date())
    const nightAltitudeAllowedMs = altitudeAllowedCoverageMs(
      raHours,
      decDeg,
      nauticalDuskUtc.getTime(),
      nauticalDawnUtc.getTime()
    )
    const requiredAltitudeAllowedMs = requiredAltitudeCoverageMs(estimatedDurationSeconds * 1000)
    if (nightAltitudeAllowedMs < requiredAltitudeAllowedMs) {
      return {
        error:
          'Session is too long for this target altitude profile tonight. Please shorten it.',
      }
    }

    const tonightWindow = getTonightAstronomicalNightWindow(new Date())
    if (estimatedDurationSeconds > tonightWindow.durationSeconds) {
      return { error: 'Session is too long to finish in one night. Please shorten it.' }
    }

    const durationMs = estimatedDurationSeconds * 1000
    const idealWindowStartMs = nauticalDuskUtc.getTime()
    const idealWindowEndMs = nauticalDawnUtc.getTime()
    const idealNightFeasible = canFitInIdealNight(raHours, decDeg, durationMs, idealWindowStartMs, idealWindowEndMs)
    if (!idealNightFeasible) {
      return {
        error:
          'Session has no valid imaging window tonight even under ideal conditions (clear weather and empty schedule). Please shorten it or change target.',
      }
    }

    if (sequenceTemplate !== 'variable_star') {
      const moonFeasible = canFitInIdealNight(
        raHours,
        decDeg,
        durationMs,
        idealWindowStartMs,
        idealWindowEndMs,
        normalizedFilterPlans
      )
      if (!moonFeasible) {
        return {
          error:
            'The Moon is too close to this target tonight for the requested filter(s). Please image after the Moon moves away, choose narrowband filters, or pick another target.',
        }
      }
    }
  }

  const userId = typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined
  if (!userId) {
    return { error: 'Authentication required to submit imaging requests.' }
  }
  const sessionPassword = typeof input.sessionPassword === 'string' ? input.sessionPassword.trim() : ''
  let sessionPasswordHash: string | undefined
  if (sessionPassword.length > 128) {
    return { error: 'Session password must be at most 128 characters' }
  }
  if (sessionPassword) {
    sessionPasswordHash = await hashSessionPassword(sessionPassword)
  }

  let ninaSequenceJson: string
  try {
    ninaSequenceJson = buildNinaSequenceJson({
      raHoursDecimal: raHours,
      decDegDecimal: decDeg,
      filterName: sequenceTemplate === 'variable_star' ? 'G' : filter,
      exposureSeconds: normalizedFilterPlans[0].exposureSeconds,
      exposureCount: normalizedFilterPlans[0].count,
      pomfretQueueId: id,
      outputMode,
      cameraCoolingTempC: input.cameraCoolingTempC,
      templateKind: sequenceTemplate,
      targetName: target,
      filterPlans: normalizedFilterPlans.map((p) => ({
        filterName: sequenceTemplate === 'variable_star' ? 'G' : p.filterName,
        exposureSeconds: p.exposureSeconds,
        exposureCount: p.count,
      })),
      variableStarObservingSeconds:
        sequenceTemplate === 'variable_star'
          ? Math.max(0, estimatedDurationSeconds - VARIABLE_STAR_SESSION_OVERHEAD_SEC)
          : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to build NINA sequence'
    return { error: msg }
  }

  const ts = nowIso()
  const req: ImagingRequest = {
    id,
    createdAt: ts,
    updatedAt: ts,
    status: 'pending',
    target,
    raHours,
    decDeg,
    filter,
    exposureSeconds: normalizedFilterPlans[0].exposureSeconds,
    count: normalizedFilterPlans[0].count,
    outputMode,
    cameraCoolingTempC: input.cameraCoolingTempC,
    filterPlans: normalizedFilterPlans,
    estimatedDurationSeconds,
    notes,
    firstName,
    lastName,
    email,
    ninaSequenceJson,
    ...(sessionPasswordHash ? { sessionPasswordHash } : {}),
    sequenceTemplate,
    ...(projectMode ? { projectMode: true as const } : {}),
    ...(mosaicMode && Array.isArray(input.mosaicPanels) && input.mosaicPanels.length > 0
      ? {
          mosaicMode: true as const,
          mosaicPanels: input.mosaicPanels,
          ...(Array.isArray(input.mosaicFilterPlansByPanel) &&
          input.mosaicFilterPlansByPanel.length === input.mosaicPanels.length
            ? { mosaicFilterPlansByPanel: input.mosaicFilterPlansByPanel }
            : {}),
        }
      : {}),
    ...(userId ? { userId } : {}),
  }

  mem.push(req)
  if (mem.length > MAX_QUEUE) {
    mem.splice(0, mem.length - MAX_QUEUE)
  }
  await persist()
  return req
}

export async function updatePendingRequestById(
  id: string,
  input: CreateImagingInput
): Promise<ImagingRequest | { error: string; status?: number }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return { error: 'Not found', status: 404 }
  const current = mem[idx]
  if (current.status !== 'pending' && current.status !== 'scheduled') {
    return { error: "Session already started, can't edit session", status: 409 }
  }

  if (input.raHours == null || String(input.raHours).trim() === '') return { error: 'RA is required' }
  const raHours = Number(input.raHours)
  if (!Number.isFinite(raHours) || raHours < 0 || raHours >= 24) return { error: 'RA (hours) must be between 0 and 24' }

  if (input.decDeg == null || String(input.decDeg).trim() === '') return { error: 'Dec is required' }
  const decDeg = Number(input.decDeg)
  if (!Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90) return { error: 'Dec (degrees) must be between -90 and 90' }

  const mosaicModeEarly =
    input.sequenceTemplate !== 'variable_star' && input.mosaicMode === true
  if (mosaicModeEarly && Array.isArray(input.mosaicPanels) && input.mosaicPanels.length > 0) {
    for (const panel of input.mosaicPanels) {
      const panelDec = Number(panel.decDeg)
      if (!Number.isFinite(panelDec)) continue
      const obsErr = pomfretTargetObservabilityError(panelDec)
      if (obsErr) {
        const label = typeof panel.name === 'string' && panel.name.trim() ? panel.name.trim() : `Panel ${panel.id}`
        return { error: `${label}: ${obsErr}` }
      }
    }
  } else {
    const obsErr = pomfretTargetObservabilityError(decDeg)
    if (obsErr) return { error: obsErr }
  }

  const exposureSeconds = Math.round(Number(input.exposureSeconds))
  const count = Math.round(Number(input.count))
  const sequenceTemplate: 'dso' | 'variable_star' =
    input.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso'
  const filterRaw =
    sequenceTemplate === 'variable_star'
      ? 'G'
      : input.filter == null
        ? ''
        : input.filter === ''
          ? ''
          : String(input.filter).trim().slice(0, MAX_FILTER)
  if (!filterRaw) return { error: 'Filter is required' }
  const filter = filterRaw

  const normalizedFilterPlans =
    sequenceTemplate === 'variable_star'
      ? [{ filterName: 'G', exposureSeconds, count }]
      : Array.isArray(input.filterPlans) && input.filterPlans.length > 0
      ? input.filterPlans
          .map((p) => {
            const filterName = typeof p.filterName === 'string' ? p.filterName.trim().slice(0, MAX_FILTER) : ''
            const exposure = Math.round(Number(p.exposureSeconds))
            const frames = Math.round(Number(p.count))
            return { filterName, exposureSeconds: exposure, count: frames }
          })
          .filter((p) => p.filterName !== '')
      : [{ filterName: filter, exposureSeconds, count }]
  if (normalizedFilterPlans.length === 0) return { error: 'At least one filter plan is required' }
  for (const plan of normalizedFilterPlans) {
    if (!Number.isFinite(plan.exposureSeconds) || plan.exposureSeconds < 1 || plan.exposureSeconds > 3600) {
      return { error: 'Exposure must be between 1 and 3600 seconds' }
    }
    if (!Number.isFinite(plan.count) || plan.count < 1) {
      return { error: 'Count must be at least 1' }
    }
  }

  const customTarget =
    input.target != null && String(input.target).trim() !== '' ? String(input.target).trim().slice(0, MAX_TARGET) : ''
  const target = customTarget || targetLabelFromCoords(raHours, decDeg)
  const firstName = typeof input.firstName === 'string' && input.firstName.trim() ? input.firstName.trim().slice(0, 80) : null
  const lastName = typeof input.lastName === 'string' && input.lastName.trim() ? input.lastName.trim().slice(0, 80) : null
  const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim().slice(0, 200) : null
  if (!email) return { error: 'Email is required' }
  if (!EMAIL_REGEX.test(email)) return { error: 'Invalid email format' }

  const outputMode: 'raw_zip' | 'stacked_master' | 'none' =
    input.outputMode === 'stacked_master' ? 'stacked_master' : input.outputMode === 'none' ? 'none' : 'raw_zip'
  if (
    outputMode === 'stacked_master' &&
    normalizedFilterPlans.some((p) => p.exposureSeconds !== STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS)
  ) {
    return { error: '600s is required for stacked master mode.' }
  }

  const estimatedDurationSeconds =
    sequenceTemplate === 'variable_star'
      ? (() => {
          const custom = variableStarDurationFromClientEstimate(input.estimatedDurationSeconds)
          if (custom.ok) return custom.seconds
          return Math.max(
            0,
            Math.round(
              altitudeCoverageMsAtMinAltitude(
                raHours,
                decDeg,
                getTonightAstronomicalNightWindow(new Date()).astronomicalDuskUtc.getTime(),
                getTonightAstronomicalNightWindow(new Date()).astronomicalDawnUtc.getTime(),
                VARIABLE_STAR_ESTIMATE_ALTITUDE_DEG
              ) / 1000
            )
          )
        })()
      : dsoSessionDurationSeconds({ filterPlans: normalizedFilterPlans })
  const projectMode = current.projectMode === true || input.mosaicMode === true || input.projectMode === true
  if (!projectMode) {
    const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(new Date())
    const nightAltitudeAllowedMs = altitudeAllowedCoverageMs(
      raHours,
      decDeg,
      nauticalDuskUtc.getTime(),
      nauticalDawnUtc.getTime()
    )
    if (nightAltitudeAllowedMs < requiredAltitudeCoverageMs(estimatedDurationSeconds * 1000)) {
      return { error: 'Session is too long for this target altitude profile tonight. Please shorten it.' }
    }
    const tonightWindow = getTonightAstronomicalNightWindow(new Date())
    if (estimatedDurationSeconds > tonightWindow.durationSeconds) {
      return { error: 'Session is too long to finish in one night. Please shorten it.' }
    }
    const idealNightFeasible = canFitInIdealNight(
      raHours,
      decDeg,
      estimatedDurationSeconds * 1000,
      nauticalDuskUtc.getTime(),
      nauticalDawnUtc.getTime()
    )
    if (!idealNightFeasible) {
      return {
        error:
          'Session has no valid imaging window tonight even under ideal conditions (clear weather and empty schedule). Please shorten it or change target.',
      }
    }
    if (sequenceTemplate !== 'variable_star') {
      const moonFeasible = canFitInIdealNight(
        raHours,
        decDeg,
        estimatedDurationSeconds * 1000,
        nauticalDuskUtc.getTime(),
        nauticalDawnUtc.getTime(),
        normalizedFilterPlans
      )
      if (!moonFeasible) {
        return {
          error:
            'The Moon is too close to this target tonight for the requested filter(s). Please image after the Moon moves away, choose narrowband filters, or pick another target.',
        }
      }
    }
  }

  let sessionPasswordHash = current.sessionPasswordHash
  const nextPassword = typeof input.sessionPassword === 'string' ? input.sessionPassword.trim() : ''
  if (nextPassword) {
    if (nextPassword.length > 128) return { error: 'Session password must be at most 128 characters' }
    sessionPasswordHash = await hashSessionPassword(nextPassword)
  }
  const ownedByMember = typeof current.userId === 'string' && current.userId.length > 0
  if (!sessionPasswordHash && !ownedByMember) {
    return { error: 'Session password is required' }
  }

  const cameraCoolingTempC = input.cameraCoolingTempC ?? current.cameraCoolingTempC

  let ninaSequenceJson: string
  try {
    ninaSequenceJson = buildNinaSequenceJson({
      raHoursDecimal: raHours,
      decDegDecimal: decDeg,
      filterName: sequenceTemplate === 'variable_star' ? 'G' : filter,
      exposureSeconds: normalizedFilterPlans[0].exposureSeconds,
      exposureCount: normalizedFilterPlans[0].count,
      pomfretQueueId: id,
      outputMode,
      cameraCoolingTempC,
      templateKind: sequenceTemplate,
      targetName: target,
      filterPlans: normalizedFilterPlans.map((p) => ({
        filterName: sequenceTemplate === 'variable_star' ? 'G' : p.filterName,
        exposureSeconds: p.exposureSeconds,
        exposureCount: p.count,
      })),
      variableStarObservingSeconds:
        sequenceTemplate === 'variable_star'
          ? Math.max(0, estimatedDurationSeconds - VARIABLE_STAR_SESSION_OVERHEAD_SEC)
          : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to build NINA sequence'
    return { error: msg }
  }

  const next: ImagingRequest = {
    ...current,
    status: 'pending',
    plannedStartIso: null,
    scheduleReasons: undefined,
    updatedAt: nowIso(),
    target,
    raHours,
    decDeg,
    filter,
    exposureSeconds: normalizedFilterPlans[0].exposureSeconds,
    count: normalizedFilterPlans[0].count,
    outputMode,
    cameraCoolingTempC,
    filterPlans: normalizedFilterPlans,
    estimatedDurationSeconds,
    firstName,
    lastName,
    email,
    ninaSequenceJson,
    sessionPasswordHash,
    sequenceTemplate,
    ...(projectMode ? { projectMode: true as const } : {}),
    ...(input.mosaicMode === true &&
    Array.isArray(input.mosaicPanels) &&
    input.mosaicPanels.length > 0
      ? {
          mosaicMode: true as const,
          mosaicPanels: input.mosaicPanels,
          ...(Array.isArray(input.mosaicFilterPlansByPanel) &&
          input.mosaicFilterPlansByPanel.length === input.mosaicPanels.length
            ? { mosaicFilterPlansByPanel: input.mosaicFilterPlansByPanel }
            : {}),
        }
      : { mosaicMode: false, mosaicPanels: undefined, mosaicFilterPlansByPanel: undefined }),
  }
  delete (next as { scheduleStatus?: unknown }).scheduleStatus
  mem[idx] = next
  await persist()
  return next
}

export async function updateStatus(
  id: string,
  status: ImagingRequestStatus
): Promise<ImagingRequest | { error: string }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) {
    return { error: 'Not found' }
  }

  const current = mem[idx]
  if (current.status === 'completed' || current.status === 'failed' || current.status === 'rejected') {
    return { error: 'Request is already finished' }
  }

  if (status === 'in_progress' && current.status !== 'pending' && current.status !== 'scheduled') {
    return { error: 'Can only move pending or scheduled requests to in progress' }
  }
  if ((status === 'completed' || status === 'failed') && current.status !== 'in_progress') {
    return { error: 'Complete or fail only from in progress' }
  }

  const next: ImagingRequest = {
    ...current,
    status,
    updatedAt: nowIso(),
  }
  mem[idx] = next
  await persist()
  return next
}

/** Admin Session Control: restore a failed queue row to in_progress. */
export async function adminRestoreQueueFromFailed(
  id: string
): Promise<ImagingRequest | { error: string }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return { error: 'Not found' }
  const current = mem[idx]
  if (current.status !== 'failed') {
    return { error: 'Only failed requests can be restored to in progress' }
  }
  const next: ImagingRequest = { ...current, status: 'in_progress', updatedAt: nowIso() }
  mem[idx] = next
  await persist()
  return next
}

/** Admin Session Control: force terminal status from any non-terminal queue row. */
export async function adminForceQueueStatus(
  id: string,
  status: 'completed' | 'failed'
): Promise<ImagingRequest | { error: string }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return { error: 'Not found' }
  const current = mem[idx]
  if (current.status === 'completed' || current.status === 'failed' || current.status === 'rejected') {
    return { error: 'Request is already finished' }
  }
  const next: ImagingRequest = { ...current, status, updatedAt: nowIso() }
  mem[idx] = next
  await persist()
  return next
}

/** Keep rejected submits in queue for member session history (not offered to NINA). */
export async function markQueueRejected(
  id: string,
  reasons: string[]
): Promise<ImagingRequest | { error: string }> {
  await ensureLoadedFromDisk()
  const mem = getMemory()
  const idx = mem.findIndex((r) => r.id === id)
  if (idx === -1) return { error: 'Not found' }
  const current = mem[idx]
  if (current.status === 'completed' || current.status === 'failed' || current.status === 'rejected') {
    return { error: 'Request is already finished' }
  }
  const next: ImagingRequest = {
    ...current,
    status: 'rejected',
    plannedStartIso: null,
    scheduleReasons: reasons,
    updatedAt: nowIso(),
  }
  mem[idx] = next
  await persist()
  return next
}
