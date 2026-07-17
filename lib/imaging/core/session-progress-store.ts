import { kvDel, kvEnabled, kvExpire, kvListPush, kvListRange } from '@/lib/kv-rest'
import type { SessionProgressLine } from '@/lib/imaging/core/audit-log'

const KEY_PREFIX = 'imaging-session-progress:'
const MAX_LINES = 400
/** Drop idle session transcripts after two weeks. */
const TTL_SEC = 60 * 60 * 24 * 14

type GlobalWithProgressLines = typeof globalThis & {
  __pomfret_session_progress_lines__?: Map<string, SessionProgressLine[]>
}

function memoryMap(): Map<string, SessionProgressLine[]> {
  const g = globalThis as GlobalWithProgressLines
  if (!g.__pomfret_session_progress_lines__) {
    g.__pomfret_session_progress_lines__ = new Map()
  }
  return g.__pomfret_session_progress_lines__
}

function progressKey(queueId: string): string {
  return `${KEY_PREFIX}${queueId}`
}

function parseLine(raw: string): SessionProgressLine | null {
  try {
    const parsed = JSON.parse(raw) as SessionProgressLine
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.at !== 'string' || typeof parsed.text !== 'string') return null
    return { at: parsed.at, text: parsed.text }
  } catch {
    return null
  }
}

/** Append one terminal line for a session (Redis LIST when KV is configured). */
export async function appendSessionProgressLine(
  queueId: string,
  line: SessionProgressLine
): Promise<void> {
  const id = queueId.trim()
  if (!id) return
  const entry: SessionProgressLine = {
    at: line.at,
    text: line.text.slice(0, 2000),
  }

  const mem = memoryMap()
  const prev = mem.get(id) ?? []
  const next = [...prev, entry]
  mem.set(id, next.length > MAX_LINES ? next.slice(-MAX_LINES) : next)

  if (!kvEnabled()) return
  await kvListPush(progressKey(id), JSON.stringify(entry), MAX_LINES)
  await kvExpire(progressKey(id), TTL_SEC)
}

/**
 * Newest-last lines for Remote terminal. Prefers the per-session list (small reads).
 * Falls back to the legacy audit monolith only when the list is empty (pre-migration history).
 */
export async function listSessionProgressLines(
  queueId: string,
  limit = MAX_LINES
): Promise<SessionProgressLine[]> {
  const id = queueId.trim()
  if (!id) return []
  const n = Math.min(Math.max(1, limit), MAX_LINES)

  if (kvEnabled()) {
    const rawItems = await kvListRange(progressKey(id), 0, n - 1)
    const lines: SessionProgressLine[] = []
    for (const raw of rawItems) {
      const line = parseLine(raw)
      if (line) lines.push(line)
    }
    // LPUSH stores newest first; terminal expects chronological order.
    lines.reverse()
    if (lines.length > 0) return lines
  } else {
    const mem = memoryMap().get(id)
    if (mem && mem.length > 0) return mem.slice(-n)
  }

  const { listSessionProgressLinesFromAudit } = await import('@/lib/imaging/core/audit-log')
  return listSessionProgressLinesFromAudit(id, n)
}

export async function clearSessionProgressLines(queueId: string): Promise<void> {
  const id = queueId.trim()
  if (!id) return
  memoryMap().delete(id)
  if (kvEnabled()) await kvDel(progressKey(id))
}
