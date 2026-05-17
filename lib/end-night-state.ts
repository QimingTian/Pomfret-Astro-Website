import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

type GlobalState = typeof globalThis & {
  __pomfret_end_night_sent_after_sessions__?: Record<string, boolean>
  __pomfret_end_night_sent_dawn__?: Record<string, boolean>
  __pomfret_end_night_due__?: Record<string, boolean>
}

/** After last scheduled session is consumed for the night. */
const KEY_AFTER_SESSIONS = 'imaging-end-night-sent'
/** Nautical dawn shutdown — independent; may run even if after-sessions end night already ran. */
const KEY_DAWN = 'imaging-end-night-sent-dawn'
const DUE_KEY_PREFIX = 'imaging-end-night-due'

function afterSessionsMemory(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_sent_after_sessions__) g.__pomfret_end_night_sent_after_sessions__ = {}
  return g.__pomfret_end_night_sent_after_sessions__
}

function dawnMemory(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_sent_dawn__) g.__pomfret_end_night_sent_dawn__ = {}
  return g.__pomfret_end_night_sent_dawn__
}

function dueMemoryMap(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_due__) g.__pomfret_end_night_due__ = {}
  return g.__pomfret_end_night_due__
}

function keyAfterSessions(nightKey: string): string {
  return `${KEY_AFTER_SESSIONS}:${nightKey}`
}

function keyDawn(nightKey: string): string {
  return `${KEY_DAWN}:${nightKey}`
}

function dueKeyForNight(nightKey: string): string {
  return `${DUE_KEY_PREFIX}:${nightKey}`
}

async function readSentFlag(
  nightKey: string,
  mem: Record<string, boolean>,
  kvKey: string
): Promise<boolean> {
  if (!nightKey) return false
  if (mem[nightKey]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ sent?: unknown }>(kvKey)
  const sent = remote?.sent === true
  if (sent) mem[nightKey] = true
  return sent
}

async function writeSentFlag(nightKey: string, mem: Record<string, boolean>, kvKey: string): Promise<void> {
  if (!nightKey) return
  mem[nightKey] = true
  if (!kvEnabled()) return
  await kvSetJson(kvKey, { sent: true, at: new Date().toISOString() })
}

export async function wasEndNightAfterSessionsSent(nightKey: string): Promise<boolean> {
  return readSentFlag(nightKey, afterSessionsMemory(), keyAfterSessions(nightKey))
}

export async function wasEndNightDawnSent(nightKey: string): Promise<boolean> {
  return readSentFlag(nightKey, dawnMemory(), keyDawn(nightKey))
}

/** Set when the last scheduled session for this night was consumed — next poll should deliver end night. */
export async function markEndNightDue(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = dueMemoryMap()
  mem[nightKey] = true
  if (!kvEnabled()) return
  await kvSetJson(dueKeyForNight(nightKey), { due: true, at: new Date().toISOString() })
}

export async function isEndNightDue(nightKey: string): Promise<boolean> {
  if (!nightKey) return false
  const mem = dueMemoryMap()
  if (mem[nightKey]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ due?: unknown }>(dueKeyForNight(nightKey))
  const due = remote?.due === true
  if (due) mem[nightKey] = true
  return due
}

async function clearEndNightDue(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = dueMemoryMap()
  delete mem[nightKey]
  if (!kvEnabled()) return
  await kvSetJson(dueKeyForNight(nightKey), { due: false, clearedAt: new Date().toISOString() })
}

export async function markEndNightAfterSessionsSent(nightKey: string): Promise<void> {
  if (!nightKey) return
  await writeSentFlag(nightKey, afterSessionsMemory(), keyAfterSessions(nightKey))
  await clearEndNightDue(nightKey)
}

export async function markEndNightDawnSent(nightKey: string): Promise<void> {
  if (!nightKey) return
  await writeSentFlag(nightKey, dawnMemory(), keyDawn(nightKey))
}
