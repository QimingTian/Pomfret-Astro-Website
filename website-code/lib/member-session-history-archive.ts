import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import type { MemberSessionHistoryRow } from '@/lib/member-session-history'

export const MEMBER_SESSION_HISTORY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000

const keyForUser = (userId: string) => `member-session-history:${userId}`

type Payload = { sessions: MemberSessionHistoryRow[] }

type GlobalArchive = typeof globalThis & {
  __pomfret_member_session_history__?: Record<string, MemberSessionHistoryRow[]>
}

function memoryForUser(userId: string): MemberSessionHistoryRow[] {
  const g = globalThis as GlobalArchive
  if (!g.__pomfret_member_session_history__) g.__pomfret_member_session_history__ = {}
  if (!g.__pomfret_member_session_history__[userId]) g.__pomfret_member_session_history__[userId] = []
  return g.__pomfret_member_session_history__[userId]
}

async function readArchive(userId: string): Promise<MemberSessionHistoryRow[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(keyForUser(userId))
    return Array.isArray(remote?.sessions) ? remote.sessions : []
  }
  return [...memoryForUser(userId)]
}

async function writeArchive(userId: string, sessions: MemberSessionHistoryRow[]): Promise<void> {
  if (kvEnabled()) {
    await kvSetJson(keyForUser(userId), { sessions })
    return
  }
  const g = globalThis as GlobalArchive
  if (!g.__pomfret_member_session_history__) g.__pomfret_member_session_history__ = {}
  g.__pomfret_member_session_history__[userId] = sessions
}

function withinRetention(row: MemberSessionHistoryRow, nowMs: number): boolean {
  const basis = Date.parse(row.updatedAt || row.createdAt)
  if (!Number.isFinite(basis)) return true
  return nowMs - basis <= MEMBER_SESSION_HISTORY_RETENTION_MS
}

export async function recordMemberSessionHistory(
  userId: string,
  row: MemberSessionHistoryRow
): Promise<void> {
  if (!userId.trim()) return
  try {
    const nowMs = Date.now()
    const prev = (await readArchive(userId)).filter((s) => withinRetention(s, nowMs))
    const idx = prev.findIndex((s) => s.id === row.id)
    const next = [...prev]
    if (idx === -1) next.unshift(row)
    else next[idx] = { ...next[idx], ...row }
    await writeArchive(userId, next)
  } catch {
    // ignore
  }
}

export async function syncMemberSessionHistoryArchive(
  userId: string,
  live: MemberSessionHistoryRow[]
): Promise<MemberSessionHistoryRow[]> {
  const nowMs = Date.now()
  const prev = (await readArchive(userId)).filter((s) => withinRetention(s, nowMs))
  const byId = new Map<string, MemberSessionHistoryRow>()
  for (const s of prev) byId.set(s.id, s)
  for (const s of live) byId.set(s.id, s)
  const merged = Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  await writeArchive(userId, merged)
  return merged
}
