import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

type GlobalState = typeof globalThis & {
  __pomfret_end_night_sent__?: Record<string, boolean>
  __pomfret_end_night_due__?: Record<string, boolean>
}

const KEY_PREFIX = 'imaging-end-night-sent'
const DUE_KEY_PREFIX = 'imaging-end-night-due'

function memoryMap(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_sent__) g.__pomfret_end_night_sent__ = {}
  return g.__pomfret_end_night_sent__
}

function dueMemoryMap(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_due__) g.__pomfret_end_night_due__ = {}
  return g.__pomfret_end_night_due__
}

function keyForNight(nightKey: string): string {
  return `${KEY_PREFIX}:${nightKey}`
}

function dueKeyForNight(nightKey: string): string {
  return `${DUE_KEY_PREFIX}:${nightKey}`
}

export async function wasEndNightSent(nightKey: string): Promise<boolean> {
  if (!nightKey) return false
  const mem = memoryMap()
  if (mem[nightKey]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ sent?: unknown }>(keyForNight(nightKey))
  const sent = remote?.sent === true
  if (sent) mem[nightKey] = true
  return sent
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

export async function markEndNightSent(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = memoryMap()
  mem[nightKey] = true
  await clearEndNightDue(nightKey)
  if (!kvEnabled()) return
  await kvSetJson(keyForNight(nightKey), { sent: true, at: new Date().toISOString() })
}
