import {
  fallbackScheduleBarPlacement,
  type ScheduleBarPlacement,
} from '@/lib/imaging-schedule-bar'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

/** Sessions removed from the API queue after NINA download, still shown on Remote. */
export type SessionBoardStatus = 'in_progress' | 'completed' | 'failed'

export type SessionBoardEntry = {
  id: string
  target: string
  createdAt: string
  updatedAt: string
  status: SessionBoardStatus
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  raHours?: number | null
  decDeg?: number | null
  filter?: string | null
  exposureSeconds?: number
  count?: number
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  estimatedDurationSeconds?: number
  completedAt?: string
  failedAt?: string
  downloadedAt?: string
  sessionPasswordHash?: string
  userId?: string
  /** Frozen Tonight's Schedule bar for this strip night (survives refresh / other devices). */
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
  /** Multi-night DSO project (board id = project id). */
  projectMode?: boolean
}

const KEY = 'imaging-session-board'
const MAX_ENTRIES = 50

type Payload = { entries: SessionBoardEntry[] }

type GlobalWithBoard = typeof globalThis & {
  __pomfret_imaging_session_board__?: SessionBoardEntry[]
}

function memoryEntries(): SessionBoardEntry[] {
  const g = globalThis as GlobalWithBoard
  if (!g.__pomfret_imaging_session_board__) g.__pomfret_imaging_session_board__ = []
  return g.__pomfret_imaging_session_board__
}

function normalizeEntries(raw: unknown): SessionBoardEntry[] {
  if (!raw || typeof raw !== 'object') return []
  const entries = (raw as Payload).entries
  if (!Array.isArray(entries)) return []
  return entries.filter(
    (e): e is SessionBoardEntry =>
      e != null &&
      typeof e === 'object' &&
      typeof (e as SessionBoardEntry).id === 'string' &&
      typeof (e as SessionBoardEntry).target === 'string' &&
      typeof (e as SessionBoardEntry).createdAt === 'string' &&
      typeof (e as SessionBoardEntry).updatedAt === 'string' &&
      ((e as SessionBoardEntry).status === 'in_progress' ||
        (e as SessionBoardEntry).status === 'completed' ||
        (e as SessionBoardEntry).status === 'failed') &&
      ((e as SessionBoardEntry).firstName == null || typeof (e as SessionBoardEntry).firstName === 'string') &&
      ((e as SessionBoardEntry).lastName == null || typeof (e as SessionBoardEntry).lastName === 'string') &&
      ((e as SessionBoardEntry).email == null || typeof (e as SessionBoardEntry).email === 'string') &&
      ((e as SessionBoardEntry).raHours == null || typeof (e as SessionBoardEntry).raHours === 'number') &&
      ((e as SessionBoardEntry).decDeg == null || typeof (e as SessionBoardEntry).decDeg === 'number') &&
      ((e as SessionBoardEntry).filter == null || typeof (e as SessionBoardEntry).filter === 'string') &&
      ((e as SessionBoardEntry).exposureSeconds == null || typeof (e as SessionBoardEntry).exposureSeconds === 'number') &&
      ((e as SessionBoardEntry).count == null || typeof (e as SessionBoardEntry).count === 'number') &&
      ((e as SessionBoardEntry).outputMode == null ||
        (e as SessionBoardEntry).outputMode === 'raw_zip' ||
        (e as SessionBoardEntry).outputMode === 'stacked_master' ||
        (e as SessionBoardEntry).outputMode === 'none') &&
      ((e as SessionBoardEntry).filterPlans == null || Array.isArray((e as SessionBoardEntry).filterPlans)) &&
      ((e as SessionBoardEntry).estimatedDurationSeconds == null ||
        typeof (e as SessionBoardEntry).estimatedDurationSeconds === 'number') &&
      ((e as SessionBoardEntry).completedAt == null || typeof (e as SessionBoardEntry).completedAt === 'string') &&
      ((e as SessionBoardEntry).failedAt == null || typeof (e as SessionBoardEntry).failedAt === 'string') &&
      ((e as SessionBoardEntry).downloadedAt == null || typeof (e as SessionBoardEntry).downloadedAt === 'string') &&
      ((e as SessionBoardEntry).sessionPasswordHash == null ||
        typeof (e as SessionBoardEntry).sessionPasswordHash === 'string') &&
      ((e as SessionBoardEntry).scheduleStripNightKey == null ||
        typeof (e as SessionBoardEntry).scheduleStripNightKey === 'string') &&
      ((e as SessionBoardEntry).scheduleBarStartMs == null ||
        typeof (e as SessionBoardEntry).scheduleBarStartMs === 'number') &&
      ((e as SessionBoardEntry).scheduleBarEndMs == null ||
        typeof (e as SessionBoardEntry).scheduleBarEndMs === 'number')
  )
}

function applyScheduleBar(entry: SessionBoardEntry, bar: ScheduleBarPlacement): SessionBoardEntry {
  return {
    ...entry,
    scheduleStripNightKey: bar.nightKey,
    scheduleBarStartMs: bar.startMs,
    scheduleBarEndMs: bar.endMs,
  }
}

/**
 * Save schedule bar placement. Terminal sessions (completed/failed) are immutable once set for that night.
 */
export async function boardSetScheduleBar(
  id: string,
  bar: ScheduleBarPlacement
): Promise<{ ok: boolean; error?: string }> {
  const prev = await readEntries()
  const idx = prev.findIndex((e) => e.id === id)
  if (idx === -1) return { ok: false, error: 'Not found' }
  const current = prev[idx]!
  if (current.status !== 'in_progress' && current.status !== 'completed' && current.status !== 'failed') {
    return { ok: false, error: 'Session is not on the board' }
  }
  if (
    (current.status === 'completed' || current.status === 'failed') &&
    hasFrozenScheduleBar(current, bar.nightKey)
  ) {
    return { ok: true }
  }
  if (bar.endMs <= bar.startMs) return { ok: false, error: 'Invalid bar interval' }
  const next = [...prev]
  next[idx] = applyScheduleBar({ ...current, updatedAt: new Date().toISOString() }, bar)
  await writeEntries(next)
  return { ok: true }
}

function hasFrozenScheduleBar(entry: SessionBoardEntry, nightKey: string): boolean {
  if (entry.scheduleStripNightKey !== nightKey) return false
  const s = entry.scheduleBarStartMs
  const e = entry.scheduleBarEndMs
  return typeof s === 'number' && typeof e === 'number' && Number.isFinite(s) && Number.isFinite(e) && e > s
}

/** Backfill frozen bar for legacy completed/failed rows missing schedule fields. */
export async function boardEnsureScheduleBarForTerminal(id: string): Promise<void> {
  const entry = await getBoardEntry(id)
  if (!entry) return
  if (entry.status === 'completed' && entry.completedAt) {
    const endMs = Date.parse(entry.completedAt)
    if (Number.isFinite(endMs)) await freezeScheduleBarOnTerminal(id, endMs)
    return
  }
  if (entry.status === 'failed' && entry.failedAt) {
    const endMs = Date.parse(entry.failedAt)
    if (Number.isFinite(endMs)) await freezeScheduleBarOnTerminal(id, endMs)
  }
}

async function freezeScheduleBarOnTerminal(
  id: string,
  terminalEndMs: number,
  now = new Date()
): Promise<void> {
  const prev = await readEntries()
  const idx = prev.findIndex((e) => e.id === id)
  if (idx === -1) return
  const entry = prev[idx]!
  const strip = getTonightScheduleStrip(now)
  if (hasFrozenScheduleBar(entry, strip.nightKey)) return

  let bar: ScheduleBarPlacement
  if (
    typeof entry.scheduleBarStartMs === 'number' &&
    Number.isFinite(entry.scheduleBarStartMs) &&
    entry.scheduleStripNightKey === strip.nightKey
  ) {
    bar = {
      nightKey: strip.nightKey,
      startMs: entry.scheduleBarStartMs,
      endMs: Math.min(Math.max(terminalEndMs, entry.scheduleBarStartMs + 60_000), strip.schedulingDeadlineMs),
    }
  } else {
    bar = fallbackScheduleBarPlacement(entry, terminalEndMs, now)
  }

  const next = [...prev]
  next[idx] = applyScheduleBar(entry, bar)
  await writeEntries(next)
}

async function readEntries(): Promise<SessionBoardEntry[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    return normalizeEntries(remote)
  }
  return [...memoryEntries()]
}

async function writeEntries(entries: SessionBoardEntry[]): Promise<void> {
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { entries: trimmed })
    if (ok) return
  }
  const g = globalThis as GlobalWithBoard
  g.__pomfret_imaging_session_board__ = trimmed
}

export async function listBoardEntries(): Promise<SessionBoardEntry[]> {
  const all = await readEntries()
  return [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getBoardEntry(id: string): Promise<SessionBoardEntry | undefined> {
  const all = await readEntries()
  return all.find((e) => e.id === id)
}

/** When NINA omits `queueId` but only one session is in progress, attribute POSTs to it. */
export async function getSoleInProgressBoardId(): Promise<string | null> {
  const all = await readEntries()
  const active = all.filter((e) => e.status === 'in_progress')
  if (active.length !== 1) return null
  return active[0].id
}

/** Called when NINA consumes the latest queue row (download-and-delete). */
export async function boardUpsertInProgress(input: {
  id: string
  target: string
  createdAt: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  raHours?: number | null
  decDeg?: number | null
  filter?: string | null
  exposureSeconds?: number
  count?: number
  outputMode?: 'raw_zip' | 'stacked_master' | 'none'
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
  estimatedDurationSeconds?: number
  sessionPasswordHash?: string
  userId?: string
  projectMode?: boolean
}): Promise<void> {
  const ts = new Date().toISOString()
  const prev = await readEntries()
  const without = prev.filter((e) => e.id !== input.id)
  const entry: SessionBoardEntry = {
    id: input.id,
    target: input.target,
    createdAt: input.createdAt,
    updatedAt: ts,
    status: 'in_progress',
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    raHours: input.raHours ?? null,
    decDeg: input.decDeg ?? null,
    filter: input.filter ?? null,
    exposureSeconds: input.exposureSeconds,
    count: input.count,
    outputMode: input.outputMode,
    filterPlans: input.filterPlans,
    estimatedDurationSeconds: input.estimatedDurationSeconds,
    completedAt: undefined,
    downloadedAt: undefined,
    sessionPasswordHash: input.sessionPasswordHash,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.projectMode ? { projectMode: true as const } : {}),
  }
  await writeEntries([...without, entry])
}

export async function boardMarkCompleted(id: string): Promise<boolean> {
  const prev = await readEntries()
  const idx = prev.findIndex((e) => e.id === id && e.status === 'in_progress')
  if (idx === -1) return false
  const ts = new Date().toISOString()
  const next = [...prev]
  next[idx] = { ...next[idx], status: 'completed', completedAt: ts, updatedAt: ts, failedAt: undefined }
  await writeEntries(next)
  await freezeScheduleBarOnTerminal(id, Date.parse(ts))
  return true
}

export async function boardMarkFailed(id: string, failedAtIso?: string): Promise<boolean> {
  const prev = await readEntries()
  const idx = prev.findIndex((e) => e.id === id && e.status === 'in_progress')
  if (idx === -1) return false
  const ts = failedAtIso ?? new Date().toISOString()
  const next = [...prev]
  next[idx] = { ...next[idx], status: 'failed', failedAt: ts, updatedAt: ts }
  await writeEntries(next)
  await freezeScheduleBarOnTerminal(id, Date.parse(ts))
  return true
}

export type FailedBoardSnapshot = {
  id: string
  target: string
  email?: string | null
  firstName?: string | null
  failedAt: string
}

/** Fail every `in_progress` board row (optional except id). Returns snapshots for notifications. */
export async function boardFailAllInProgress(exceptId?: string): Promise<FailedBoardSnapshot[]> {
  const prev = await readEntries()
  const ts = new Date().toISOString()
  const failed: FailedBoardSnapshot[] = []
  let changed = false
  const next = prev.map((e) => {
    if (e.status !== 'in_progress') return e
    if (exceptId && e.id === exceptId) return e
    failed.push({
      id: e.id,
      target: e.target,
      email: e.email ?? null,
      firstName: e.firstName ?? null,
      failedAt: ts,
    })
    changed = true
    return { ...e, status: 'failed' as const, failedAt: ts, updatedAt: ts }
  })
  if (changed) {
    await writeEntries(next)
    for (const snap of failed) {
      await freezeScheduleBarOnTerminal(snap.id, Date.parse(snap.failedAt))
    }
  }
  return failed
}

export async function boardMarkDownloaded(id: string): Promise<boolean> {
  const prev = await readEntries()
  const idx = prev.findIndex((e) => e.id === id)
  if (idx === -1) return false
  const ts = new Date().toISOString()
  const next = [...prev]
  next[idx] = { ...next[idx], downloadedAt: ts, updatedAt: ts }
  await writeEntries(next)
  return true
}

/** Removes board rows downloaded longer than `maxAgeMs` ago. Returns purged queue ids (for R2 cleanup). */
export async function boardPurgeDownloadedOlderThan(maxAgeMs: number): Promise<string[]> {
  const prev = await readEntries()
  const now = Date.now()
  const removedIds: string[] = []
  const filtered = prev.filter((e) => {
    if (!e.downloadedAt) return true
    const at = Date.parse(e.downloadedAt)
    if (!Number.isFinite(at)) return true
    if (now - at >= maxAgeMs) {
      removedIds.push(e.id)
      return false
    }
    return true
  })
  if (filtered.length === prev.length) return []
  await writeEntries(filtered)
  return removedIds
}

/** Removes board rows completed longer than `maxAgeMs` ago. Returns purged queue ids. */
export async function boardPurgeCompletedOlderThan(maxAgeMs: number): Promise<string[]> {
  const prev = await readEntries()
  const now = Date.now()
  const removedIds: string[] = []
  const filtered = prev.filter((e) => {
    if (e.projectMode === true) return true
    if (e.status !== 'completed' && e.status !== 'failed') return true
    const basis = e.status === 'failed' ? (e.failedAt ?? e.updatedAt) : (e.completedAt ?? e.updatedAt)
    const at = Date.parse(basis)
    if (!Number.isFinite(at)) return true
    if (now - at >= maxAgeMs) {
      removedIds.push(e.id)
      return false
    }
    return true
  })
  if (filtered.length === prev.length) return []
  await writeEntries(filtered)
  return removedIds
}

export async function boardRemove(id: string): Promise<void> {
  const prev = await readEntries()
  await writeEntries(prev.filter((e) => e.id !== id))
}
