import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'

/**
 * End-night state is per observatory. Amsterdam and Pomfret share most calendar
 * night keys, so an unscoped flag lets one site's dome close mark the other
 * site's close as already sent — and that dome then never closes.
 */
type GlobalState = typeof globalThis & {
  __pomfret_end_night_sent_after_sessions__?: Record<string, boolean>
  __pomfret_end_night_sent_dawn__?: Record<string, boolean>
  __pomfret_end_night_due__?: Record<string, boolean>
  __pomfret_end_night_estop_suppress__?: Record<string, boolean>
}

/** Memory-map index; KV keys go through `scopedKvKey`. Both must separate sites. */
function memIndex(nightKey: string): string {
  return `${currentObservatorySiteId()}:${nightKey}`
}

/** After last scheduled session is consumed for the night. */
const KEY_AFTER_SESSIONS = 'imaging-end-night-sent'
/** Nautical dawn shutdown — independent; may run even if after-sessions end night already ran. */
const KEY_DAWN = 'imaging-end-night-sent-dawn'
const DUE_KEY_PREFIX = 'imaging-end-night-due'
const ESTOP_SUPPRESS_PREFIX = 'imaging-end-night-estop-suppress'

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

function estopSuppressMemory(): Record<string, boolean> {
  const g = globalThis as GlobalState
  if (!g.__pomfret_end_night_estop_suppress__) g.__pomfret_end_night_estop_suppress__ = {}
  return g.__pomfret_end_night_estop_suppress__
}

function keyEstopSuppress(nightKey: string): string {
  return scopedKvKey(`${ESTOP_SUPPRESS_PREFIX}:${nightKey}`)
}

function keyAfterSessions(nightKey: string): string {
  return scopedKvKey(`${KEY_AFTER_SESSIONS}:${nightKey}`)
}

function keyDawn(nightKey: string): string {
  return scopedKvKey(`${KEY_DAWN}:${nightKey}`)
}

function dueKeyForNight(nightKey: string): string {
  return scopedKvKey(`${DUE_KEY_PREFIX}:${nightKey}`)
}

async function readSentFlag(
  nightKey: string,
  mem: Record<string, boolean>,
  kvKey: string
): Promise<boolean> {
  if (!nightKey) return false
  const idx = memIndex(nightKey)
  if (mem[idx]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ sent?: unknown }>(kvKey)
  const sent = remote?.sent === true
  if (sent) mem[idx] = true
  return sent
}

async function writeSentFlag(nightKey: string, mem: Record<string, boolean>, kvKey: string): Promise<void> {
  if (!nightKey) return
  mem[memIndex(nightKey)] = true
  if (!kvEnabled()) return
  await kvSetJson(kvKey, { sent: true, at: new Date().toISOString() })
}

async function clearSentFlag(nightKey: string, mem: Record<string, boolean>, kvKey: string): Promise<void> {
  if (!nightKey) return
  delete mem[memIndex(nightKey)]
  if (!kvEnabled()) return
  await kvSetJson(kvKey, { sent: false, clearedAt: new Date().toISOString() })
}

export async function wasEndNightAfterSessionsSent(nightKey: string): Promise<boolean> {
  return readSentFlag(nightKey, afterSessionsMemory(), keyAfterSessions(nightKey))
}

export async function wasEndNightDawnSent(nightKey: string): Promise<boolean> {
  return readSentFlag(nightKey, dawnMemory(), keyDawn(nightKey))
}

/**
 * Allow after-sessions End Night to be delivered again.
 * Needed when a premature after-sessions close already ran, then more imaging finished.
 */
export async function clearEndNightAfterSessionsSent(nightKey: string): Promise<void> {
  await clearSentFlag(nightKey, afterSessionsMemory(), keyAfterSessions(nightKey))
}

/** Set when the last scheduled session for this night was consumed — next poll should deliver end night. */
export async function markEndNightDue(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = dueMemoryMap()
  mem[memIndex(nightKey)] = true
  /* Re-arm after-sessions close if a previous (possibly premature) close already ran. */
  await clearEndNightAfterSessionsSent(nightKey)
  if (!kvEnabled()) return
  await kvSetJson(dueKeyForNight(nightKey), { due: true, at: new Date().toISOString() })
}

export async function isEndNightDue(nightKey: string): Promise<boolean> {
  if (!nightKey) return false
  const mem = dueMemoryMap()
  const idx = memIndex(nightKey)
  if (mem[idx]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ due?: unknown }>(dueKeyForNight(nightKey))
  const due = remote?.due === true
  if (due) mem[idx] = true
  return due
}

/** Clear a premature end-night arm (e.g. after reconcile finds more work tonight). */
export async function clearEndNightDue(nightKey: string): Promise<void> {
  if (!nightKey) return
  const mem = dueMemoryMap()
  delete mem[memIndex(nightKey)]
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

/** Block hasTonightActivity-only end-night after ESTOP (ESTOP already closed the dome). */
export async function markEndNightSuppressedAfterEstop(nightKey: string): Promise<void> {
  if (!nightKey) return
  estopSuppressMemory()[memIndex(nightKey)] = true
  if (!kvEnabled()) return
  await kvSetJson(keyEstopSuppress(nightKey), { suppressed: true, at: new Date().toISOString() })
}

export async function isEndNightSuppressedAfterEstop(nightKey: string): Promise<boolean> {
  if (!nightKey) return false
  const mem = estopSuppressMemory()
  const idx = memIndex(nightKey)
  if (mem[idx]) return true
  if (!kvEnabled()) return false
  const remote = await kvGetJson<{ suppressed?: unknown }>(keyEstopSuppress(nightKey))
  const suppressed = remote?.suppressed === true
  if (suppressed) mem[idx] = true
  return suppressed
}

/** Cancel any armed end-night and suppress activity-only fallback when ESTOP arms. */
export async function prepareEndNightAfterEstop(nightKey: string): Promise<void> {
  await clearEndNightDue(nightKey)
  await markEndNightSuppressedAfterEstop(nightKey)
}
