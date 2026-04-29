import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { progressLineText, readQueueIdFromDetail } from '@/lib/session-progress-signal'

const KEY = 'imaging-audit-log'
const MAX_ENTRIES = 400

export type AuditLogEntry = {
  id: string
  at: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

type Payload = { entries: AuditLogEntry[] }

type GlobalWithLog = typeof globalThis & {
  __pomfret_imaging_audit_log__?: AuditLogEntry[]
}

function memoryEntries(): AuditLogEntry[] {
  const g = globalThis as GlobalWithLog
  if (!g.__pomfret_imaging_audit_log__) g.__pomfret_imaging_audit_log__ = []
  return g.__pomfret_imaging_audit_log__
}

function normalizeEntries(raw: unknown): AuditLogEntry[] {
  if (!raw || typeof raw !== 'object') return []
  const entries = (raw as Payload).entries
  if (!Array.isArray(entries)) return []
  return entries.filter(
    (e): e is AuditLogEntry =>
      e != null &&
      typeof e === 'object' &&
      typeof (e as AuditLogEntry).id === 'string' &&
      typeof (e as AuditLogEntry).at === 'string' &&
      typeof (e as AuditLogEntry).kind === 'string' &&
      typeof (e as AuditLogEntry).message === 'string'
  )
}

async function readEntries(): Promise<AuditLogEntry[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    return normalizeEntries(remote)
  }
  return [...memoryEntries()]
}

async function writeEntries(entries: AuditLogEntry[]): Promise<void> {
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { entries: trimmed })
    if (ok) return
  }
  const g = globalThis as GlobalWithLog
  g.__pomfret_imaging_audit_log__ = trimmed
}

/**
 * Append one line to the imaging admin audit log (KV when configured, else in-memory for this instance).
 * Never throws; safe to fire-and-forget.
 */
export async function appendAuditLog(input: {
  kind: string
  message: string
  detail?: Record<string, unknown>
}): Promise<void> {
  try {
    const entry: AuditLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      at: new Date().toISOString(),
      kind: input.kind,
      message: input.message,
      ...(input.detail && Object.keys(input.detail).length > 0 ? { detail: input.detail } : {}),
    }
    const prev = await readEntries()
    await writeEntries([...prev, entry])
  } catch {
    // ignore
  }
}

/** Newest first, capped. */
export async function listAuditLog(limit = 250): Promise<AuditLogEntry[]> {
  const all = await readEntries()
  const n = Math.min(Math.max(1, limit), MAX_ENTRIES)
  return [...all].slice(-n).reverse()
}

export type SessionProgressLine = { at: string; text: string }

/** Same KV-backed store as Admin activity log; filtered by `queueId` in entry detail. */
export async function listSessionProgressLinesFromAudit(
  queueId: string,
  limit = 400
): Promise<SessionProgressLine[]> {
  const entries = await listAuditLog(Math.min(Math.max(1, limit), MAX_ENTRIES))
  const matched = entries.filter((e) => {
    if (e.kind !== 'session.progress') return false
    const d =
      e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)
        ? (e.detail as Record<string, unknown>)
        : {}
    return readQueueIdFromDetail(d) === queueId
  })
  matched.sort((a, b) => a.at.localeCompare(b.at))
  return matched.map((e) => {
    const d =
      e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)
        ? (e.detail as Record<string, unknown>)
        : {}
    return { at: e.at, text: progressLineText(d) }
  })
}
