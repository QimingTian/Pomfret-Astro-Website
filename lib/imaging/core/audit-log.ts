import { postgresReadsEnabled } from '@/lib/db'
import { kvCompareAndSet, kvEnabled, kvGetJson, kvGetString, kvSetJson } from '@/lib/kv-rest'
import { auditRoutedQueueId, progressLineText, stringish } from '@/lib/session-progress-signal'

const KEY = 'imaging-audit-log'
const MAX_ENTRIES = 400
const CAS_ATTEMPTS = 6

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
  if (postgresReadsEnabled()) {
    try {
      const { loadJsonDocumentsFromPostgres } = await import('@/lib/db/read')
      const pg = await loadJsonDocumentsFromPostgres<AuditLogEntry>('audit')
      if (pg) return pg
    } catch (error) {
      console.error('[pg-read] audit failed; using KV', error)
    }
  }
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    return normalizeEntries(remote)
  }
  return [...memoryEntries()]
}

async function writeEntries(entries: AuditLogEntry[]): Promise<void> {
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries
  if (postgresReadsEnabled()) {
    const { mirrorAuditLog } = await import('@/lib/db/mirror')
    await mirrorAuditLog(trimmed)
    const g = globalThis as GlobalWithLog
    g.__pomfret_imaging_audit_log__ = trimmed
    return
  }
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { entries: trimmed })
    if (ok) {
      const g = globalThis as GlobalWithLog
      g.__pomfret_imaging_audit_log__ = trimmed
      const { mirrorAuditLog } = await import('@/lib/db/mirror')
      await mirrorAuditLog(trimmed)
      return
    }
  }
  const g = globalThis as GlobalWithLog
  g.__pomfret_imaging_audit_log__ = trimmed
}

async function compareAndWriteEntries(
  mutate: (prev: AuditLogEntry[]) => AuditLogEntry[]
): Promise<void> {
  if (postgresReadsEnabled() || !kvEnabled()) {
    const prev = postgresReadsEnabled() ? await readEntries() : memoryEntries()
    await writeEntries(mutate([...prev]))
    return
  }

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const raw = await kvGetString(KEY)
    const prev = normalizeEntries(raw ? (JSON.parse(raw) as Payload) : null)
    const next = mutate(prev)
    const trimmed = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
    const nextRaw = JSON.stringify({ entries: trimmed })
    const ok = await kvCompareAndSet(KEY, raw ?? '', nextRaw)
    if (ok) {
      const g = globalThis as GlobalWithLog
      g.__pomfret_imaging_audit_log__ = trimmed
      const { mirrorAuditLog } = await import('@/lib/db/mirror')
      await mirrorAuditLog(trimmed)
      return
    }
  }

  const prev = await readEntries()
  await writeEntries(mutate(prev))
}

/**
 * Append one line to the imaging admin audit log (KV when configured, else in-memory for this instance).
 * Never throws; safe to fire-and-forget.
 */
export async function appendAuditLog(input: {
  kind: string
  message: string
  detail?: Record<string, unknown>
  at?: string
}): Promise<void> {
  try {
    const at = input.at ?? new Date().toISOString()
    const entry: AuditLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      at,
      kind: input.kind,
      message: input.message,
      ...(input.detail && Object.keys(input.detail).length > 0 ? { detail: input.detail } : {}),
    }
    await compareAndWriteEntries((prev) => [...prev, entry])
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

/** Internal mail result rows — not shown in Remote session terminal (detail is only queueId + email/reason). */
function isSessionProgressMailNotificationEntry(e: AuditLogEntry): boolean {
  const m = e.message
  return (
    m.includes('Completion email sent for') ||
    m.includes('Completion email skipped/failed for') ||
    m.includes('Start email sent for') ||
    m.includes('Start email skipped/failed for') ||
    m.includes('Failure email sent for') ||
    m.includes('Failure email skipped/failed for')
  )
}

function detailMatchesQueueAliases(d: Record<string, unknown>, aliases: Set<string>): boolean {
  const routed = auditRoutedQueueId(d)
  if (routed && aliases.has(routed)) return true
  const subSessionId = stringish(d.subSessionId)
  if (subSessionId && aliases.has(subSessionId)) return true
  const nightId = stringish(d.nightId)
  if (nightId && aliases.has(nightId)) return true
  return false
}

/** Same KV-backed store as Admin activity log; filtered by routed sub-session / queue id in detail. */
export async function listSessionProgressLinesFromAudit(
  queueId: string,
  limit = 400
): Promise<SessionProgressLine[]> {
  const aliases = new Set([queueId])
  const entries = await listAuditLog(Math.min(Math.max(1, limit), MAX_ENTRIES))
  const matched = entries.filter((e) => {
    if (e.kind !== 'session.progress') return false
    if (isSessionProgressMailNotificationEntry(e)) return false
    const d =
      e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)
        ? (e.detail as Record<string, unknown>)
        : {}
    return detailMatchesQueueAliases(d, aliases)
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
