import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'

import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'
import { hashSessionPassword } from '@/lib/session-password'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { getTonightAstronomicalNightWindow, getTonightSchedulingWindow } from '@/lib/sunrise-window'
import { altitudeAllowedCoverageMs, altitudeCoverageMsAtMinAltitude, firstAltitudeAllowedTimeMs } from '@/lib/target-altitude'

export type ImagingRequestStatus = 'pending' | 'claimed' | 'completed' | 'failed'

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
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  /** Estimated session duration in seconds: sum(filter count * exposure) + 15min overhead. */
  estimatedDurationSeconds?: number
  notes: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  /** Full NINA sequence JSON (only present for requests created after this feature). */
  ninaSequenceJson?: string
  sessionPasswordHash?: string
  scheduleStatus?: 'scheduled' | 'unscheduled'
  plannedStartIso?: string | null
  scheduleReasons?: string[]
  sequenceTemplate?: 'dso' | 'variable_star'
}

/** Strip large JSON from API list responses; expose download path instead. */
export function toPublicImagingRequest(
  r: ImagingRequest
): Omit<ImagingRequest, 'ninaSequenceJson' | 'sessionPasswordHash'> & { ninaSequencePath?: string } {
  const { ninaSequenceJson, sessionPasswordHash, ...rest } = r
  return {
    ...rest,
    ninaSequencePath: `/api/imaging/queue/${r.id}/nina-sequence`,
  }
}

const MAX_QUEUE = 100
const MAX_TARGET = 200
const MAX_FILTER = 64
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS = 600
const VARIABLE_STAR_ESTIMATE_ALTITUDE_DEG = 40

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
    return
  }
  if (!queueFile || diskLoaded) return
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

async function persist(): Promise<void> {
  const mem = getMemory()
  const snapshot = [...mem]
  if (kvEnabled()) {
    await kvSetJson(KV_QUEUE_KEY, { requests: snapshot })
    return
  }
  if (!queueFile) return
  await mkdir(path.dirname(queueFile), { recursive: true })
  const tmp = `${queueFile}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify({ requests: snapshot }, null, 2)
  await writeFile(tmp, payload, 'utf-8')
  await rename(tmp, queueFile)
}

function nowIso() {
  return new Date().toISOString()
}

export async function listAll(): Promise<ImagingRequest[]> {
  await ensureLoadedFromDisk()
  return [...getMemory()]
}

export async function listPending(): Promise<ImagingRequest[]> {
  const all = await listAll()
  return all.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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
  const next: ImagingRequest = {
    ...current,
    scheduleStatus: insight.status,
    plannedStartIso: insight.plannedStartIso,
    scheduleReasons: insight.reasons,
    updatedAt: nowIso(),
  }
  mem[idx] = next
  await persist()
  return true
}

export interface CreateImagingInput {
  /** Optional display name; if empty, a label is derived from RA/Dec. */
  target?: string | null
  raHours: number | string
  decDeg: number | string
  filter: string | null
  exposureSeconds: number | string
  count: number | string
  sessionPassword: string
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  filterPlans?: Array<{ filterName: string; exposureSeconds: number | string; count: number | string }>
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  sequenceTemplate?: 'dso' | 'variable_star'
}

function targetLabelFromCoords(raHours: number, decDeg: number): string {
  return `RA ${raHours}h · Dec ${decDeg}°`
}

function canFitInIdealNight(
  raHours: number,
  decDeg: number,
  durationMs: number,
  windowStartMs: number,
  windowEndMs: number
): boolean {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false
  if (windowEndMs - windowStartMs < durationMs) return false
  const latestStartMs = windowEndMs - durationMs
  const STEP_MS = 5 * 60 * 1000

  // Search possible starts under ideal conditions: no weather limits, no queue blockers.
  // Still enforce target >= 30deg at start and >=80% altitude coverage over session duration.
  let cursor = windowStartMs
  while (cursor <= latestStartMs) {
    const startMs = firstAltitudeAllowedTimeMs(raHours, decDeg, cursor, latestStartMs)
    if (startMs == null) return false
    const endMs = startMs + durationMs
    if (endMs > windowEndMs) return false
    const coveredMs = altitudeAllowedCoverageMs(raHours, decDeg, startMs, endMs)
    if (coveredMs >= durationMs * 0.8) return true
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

  const exposureSeconds = Math.round(Number(input.exposureSeconds))
  const count = Math.round(Number(input.count))

  const sequenceTemplate: 'dso' | 'variable_star' =
    input.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso'
  const filterRaw =
    sequenceTemplate === 'variable_star'
      ? 'L'
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
    if (!Number.isFinite(plan.count) || plan.count < 1 || plan.count > 500) {
      return { error: 'Count must be between 1 and 500' }
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
      ? Math.max(
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
      : normalizedFilterPlans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0) + 15 * 60

  const { nauticalDuskUtc, astronomicalDawnUtc } = getTonightSchedulingWindow(new Date())
  const nightAltitudeAllowedMs = altitudeAllowedCoverageMs(
    raHours,
    decDeg,
    nauticalDuskUtc.getTime(),
    astronomicalDawnUtc.getTime()
  )
  const requiredAltitudeAllowedMs = estimatedDurationSeconds * 1000 * 0.8
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
  const idealWindowEndMs = astronomicalDawnUtc.getTime()
  const idealNightFeasible = canFitInIdealNight(raHours, decDeg, durationMs, idealWindowStartMs, idealWindowEndMs)
  if (!idealNightFeasible) {
    return {
      error:
        'Session has no valid imaging window tonight even under ideal conditions (clear weather and empty schedule). Please shorten it or change target.',
    }
  }

  const sessionPassword = typeof input.sessionPassword === 'string' ? input.sessionPassword.trim() : ''
  if (!sessionPassword) {
    return { error: 'Session password is required' }
  }
  if (sessionPassword.length > 128) {
    return { error: 'Session password must be at most 128 characters' }
  }
  const sessionPasswordHash = await hashSessionPassword(sessionPassword)

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
      templateKind: sequenceTemplate,
      targetName: target,
      filterPlans: normalizedFilterPlans.map((p) => ({
        filterName: sequenceTemplate === 'variable_star' ? 'G' : p.filterName,
        exposureSeconds: p.exposureSeconds,
        exposureCount: p.count,
      })),
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
    filterPlans: normalizedFilterPlans,
    estimatedDurationSeconds,
    notes,
    firstName,
    lastName,
    email,
    ninaSequenceJson,
    sessionPasswordHash,
    sequenceTemplate,
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
  if (current.status !== 'pending') {
    return { error: "Session already started, can't edit session", status: 409 }
  }

  if (input.raHours == null || String(input.raHours).trim() === '') return { error: 'RA is required' }
  const raHours = Number(input.raHours)
  if (!Number.isFinite(raHours) || raHours < 0 || raHours >= 24) return { error: 'RA (hours) must be between 0 and 24' }

  if (input.decDeg == null || String(input.decDeg).trim() === '') return { error: 'Dec is required' }
  const decDeg = Number(input.decDeg)
  if (!Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90) return { error: 'Dec (degrees) must be between -90 and 90' }

  const exposureSeconds = Math.round(Number(input.exposureSeconds))
  const count = Math.round(Number(input.count))
  const sequenceTemplate: 'dso' | 'variable_star' =
    input.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso'
  const filterRaw =
    sequenceTemplate === 'variable_star'
      ? 'L'
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
    if (!Number.isFinite(plan.count) || plan.count < 1 || plan.count > 500) {
      return { error: 'Count must be between 1 and 500' }
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
      ? Math.max(
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
      : normalizedFilterPlans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0) + 15 * 60
  const { nauticalDuskUtc, astronomicalDawnUtc } = getTonightSchedulingWindow(new Date())
  const nightAltitudeAllowedMs = altitudeAllowedCoverageMs(
    raHours,
    decDeg,
    nauticalDuskUtc.getTime(),
    astronomicalDawnUtc.getTime()
  )
  if (nightAltitudeAllowedMs < estimatedDurationSeconds * 1000 * 0.8) {
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
    astronomicalDawnUtc.getTime()
  )
  if (!idealNightFeasible) {
    return {
      error:
        'Session has no valid imaging window tonight even under ideal conditions (clear weather and empty schedule). Please shorten it or change target.',
    }
  }

  let sessionPasswordHash = current.sessionPasswordHash
  const nextPassword = typeof input.sessionPassword === 'string' ? input.sessionPassword.trim() : ''
  if (nextPassword) {
    if (nextPassword.length > 128) return { error: 'Session password must be at most 128 characters' }
    sessionPasswordHash = await hashSessionPassword(nextPassword)
  }
  if (!sessionPasswordHash) return { error: 'Session password is required' }

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
      templateKind: sequenceTemplate,
      targetName: target,
      filterPlans: normalizedFilterPlans.map((p) => ({
        filterName: sequenceTemplate === 'variable_star' ? 'G' : p.filterName,
        exposureSeconds: p.exposureSeconds,
        exposureCount: p.count,
      })),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to build NINA sequence'
    return { error: msg }
  }

  const next: ImagingRequest = {
    ...current,
    updatedAt: nowIso(),
    target,
    raHours,
    decDeg,
    filter,
    exposureSeconds: normalizedFilterPlans[0].exposureSeconds,
    count: normalizedFilterPlans[0].count,
    outputMode,
    filterPlans: normalizedFilterPlans,
    estimatedDurationSeconds,
    firstName,
    lastName,
    email,
    ninaSequenceJson,
    sessionPasswordHash,
    sequenceTemplate,
  }
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
  if (current.status === 'completed' || current.status === 'failed') {
    return { error: 'Request is already finished' }
  }

  if (status === 'claimed' && current.status !== 'pending') {
    return { error: 'Can only claim pending requests' }
  }
  if ((status === 'completed' || status === 'failed') && current.status === 'pending') {
    return { error: 'Claim before completing or failing' }
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
