import crypto from 'crypto'

import type { RemoteSavedSessionFormV1 } from '@/lib/remote-saved-session'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

export type MemberSavedSessionEntry = {
  id: string
  userId: string
  name: string
  savedAt: string
  updatedAt: string
  form: RemoteSavedSessionFormV1
}

const MAX_PER_USER = 40
const keyForUser = (userId: string) => `member-saved-sessions:${userId}`

type Payload = { sessions: MemberSavedSessionEntry[] }

type GlobalSaved = typeof globalThis & {
  __pomfret_member_saved_sessions__?: Record<string, MemberSavedSessionEntry[]>
}

function memoryForUser(userId: string): MemberSavedSessionEntry[] {
  const g = globalThis as GlobalSaved
  if (!g.__pomfret_member_saved_sessions__) g.__pomfret_member_saved_sessions__ = {}
  if (!g.__pomfret_member_saved_sessions__[userId]) g.__pomfret_member_saved_sessions__[userId] = []
  return g.__pomfret_member_saved_sessions__[userId]
}

async function readSessions(userId: string): Promise<MemberSavedSessionEntry[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(keyForUser(userId))
    return Array.isArray(remote?.sessions) ? remote.sessions : []
  }
  return [...memoryForUser(userId)]
}

async function writeSessions(userId: string, sessions: MemberSavedSessionEntry[]): Promise<void> {
  const trimmed = sessions.slice(0, MAX_PER_USER)
  if (kvEnabled()) {
    await kvSetJson(keyForUser(userId), { sessions: trimmed })
    return
  }
  const g = globalThis as GlobalSaved
  if (!g.__pomfret_member_saved_sessions__) g.__pomfret_member_saved_sessions__ = {}
  g.__pomfret_member_saved_sessions__[userId] = trimmed
}

export async function listMemberSavedSessions(userId: string): Promise<MemberSavedSessionEntry[]> {
  const list = await readSessions(userId)
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function upsertMemberSavedSession(
  userId: string,
  input: { name: string; form: RemoteSavedSessionFormV1 }
): Promise<MemberSavedSessionEntry> {
  const name = input.name.trim()
  if (!name) throw new Error('Session name is required')
  const nameKey = name.toLowerCase()
  const ts = new Date().toISOString()
  const prev = await readSessions(userId)
  const existing = prev.find((s) => s.name.toLowerCase() === nameKey)
  const entry: MemberSavedSessionEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    userId,
    name,
    savedAt: existing?.savedAt ?? ts,
    updatedAt: ts,
    form: input.form,
  }
  const without = prev.filter((s) => s.name.toLowerCase() !== nameKey)
  await writeSessions(userId, [entry, ...without])
  return entry
}

export async function deleteMemberSavedSession(userId: string, id: string): Promise<boolean> {
  const prev = await readSessions(userId)
  const next = prev.filter((s) => s.id !== id)
  if (next.length === prev.length) return false
  await writeSessions(userId, next)
  return true
}

export async function getMemberSavedSessionByName(
  userId: string,
  name: string
): Promise<MemberSavedSessionEntry | null> {
  const nameKey = name.trim().toLowerCase()
  if (!nameKey) return null
  const list = await readSessions(userId)
  return list.find((s) => s.name.toLowerCase() === nameKey) ?? null
}

export async function getMemberSavedSessionById(
  userId: string,
  id: string
): Promise<MemberSavedSessionEntry | null> {
  if (!id.trim()) return null
  const list = await readSessions(userId)
  return list.find((s) => s.id === id) ?? null
}
