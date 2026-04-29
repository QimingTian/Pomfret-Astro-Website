import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

type GlobalState = typeof globalThis & {
  __pomfret_end_night_sent__?: Record<string, boolean>
}

const KEY_PREFIX = 'imaging-end-night-sent'

function memoryMap(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_sent__) g.__pomfret_end_night_sent__ = {}
  return g.__pomfret_end_night_sent__
}

function keyForNight(nightKey: string): string {
  return `${KEY_PREFIX}:${nightKey}`
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

export async function markEndNightSent(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = memoryMap()
  mem[nightKey] = true
  if (!kvEnabled()) return
  await kvSetJson(keyForNight(nightKey), { sent: true, at: new Date().toISOString() })
}
