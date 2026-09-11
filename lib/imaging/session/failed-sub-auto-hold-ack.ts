import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'

/**
 * After a manual (or weather-safety) ESTOP clear, tonight's failed subs must not
 * keep auto-holding / minting new on_hold rows. Clear = operator resumed the night.
 * A later NEW failure clears this ack so auto-hold applies again.
 *
 * Site-scoped (scopedKvKey + per-site memory). When KV is enabled, ensure* always
 * hydrates from KV so isolates do not keep a stale in-memory ack.
 */
type AckPayload = { nightKey: string; at: string }

/** Explicit clear tombstone — normalizeAck rejects empty nightKey. */
type AckTombstone = { nightKey: ''; cleared: true; at: string }

type GlobalWithAck = typeof globalThis & {
  __pomfret_failed_sub_auto_hold_ack_by_site__?: Record<string, AckPayload | null>
}

function ackKvKey(): string {
  return scopedKvKey('imaging-failed-sub-auto-hold-ack')
}

function memoryAck(): AckPayload | null {
  const g = globalThis as GlobalWithAck
  return g.__pomfret_failed_sub_auto_hold_ack_by_site__?.[currentObservatorySiteId()] ?? null
}

function setMemoryAck(payload: AckPayload | null): void {
  const g = globalThis as GlobalWithAck
  if (!g.__pomfret_failed_sub_auto_hold_ack_by_site__) {
    g.__pomfret_failed_sub_auto_hold_ack_by_site__ = {}
  }
  g.__pomfret_failed_sub_auto_hold_ack_by_site__[currentObservatorySiteId()] = payload
}

export function normalizeFailedSubTonightAutoHoldAck(raw: unknown): AckPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.cleared === true) return null
  const nightKey = typeof r.nightKey === 'string' ? r.nightKey.trim() : ''
  if (!nightKey) return null
  const at = typeof r.at === 'string' && r.at.trim() ? r.at : new Date().toISOString()
  return { nightKey, at }
}

/** Sync check used by planner. Call ensure* before planning when possible. */
export function isFailedSubTonightAutoHoldAcknowledged(nightKey: string): boolean {
  const key = nightKey.trim()
  if (!key) return false
  return memoryAck()?.nightKey === key
}

/**
 * Hydrate memory from KV when enabled. Always prefers KV over stale memory.
 * Drops memory ack whose nightKey is not tonight's strip key.
 */
export async function ensureFailedSubTonightAutoHoldAckLoaded(
  tonightNightKey?: string
): Promise<void> {
  const tonight = (tonightNightKey ?? getTonightScheduleStrip().nightKey).trim()

  if (kvEnabled()) {
    try {
      const raw = await kvGetJson<unknown>(ackKvKey())
      const parsed = normalizeFailedSubTonightAutoHoldAck(raw)
      if (!parsed || (tonight && parsed.nightKey !== tonight)) {
        setMemoryAck(null)
      } else {
        setMemoryAck(parsed)
      }
      return
    } catch {
      // fall through to memory nightKey check
    }
  }

  const mem = memoryAck()
  if (mem && tonight && mem.nightKey !== tonight) {
    setMemoryAck(null)
  }
}

/** ESTOP clear: remaining tonight work may schedule despite earlier failed subs. */
export async function acknowledgeFailedSubTonightAutoHold(nightKey?: string): Promise<string> {
  const key = (nightKey ?? getTonightScheduleStrip().nightKey).trim()
  const payload: AckPayload = { nightKey: key, at: new Date().toISOString() }
  setMemoryAck(payload)
  if (kvEnabled()) {
    try {
      await kvSetJson(ackKvKey(), payload)
    } catch {
      // memory still set for this isolate
    }
  }
  return key
}

/** New failure tonight: auto-hold siblings again until the next clear. */
export async function clearFailedSubTonightAutoHoldAck(): Promise<void> {
  setMemoryAck(null)
  if (!kvEnabled()) return
  try {
    const tombstone: AckTombstone = {
      nightKey: '',
      cleared: true,
      at: new Date().toISOString(),
    }
    await kvSetJson(ackKvKey(), tombstone)
  } catch {
    // ignore
  }
}

/** Test helper — reset in-memory ack without touching KV. */
export function resetFailedSubTonightAutoHoldAckForTests(): void {
  setMemoryAck(null)
}

/** Test helper — seed in-memory ack without KV. */
export function setFailedSubTonightAutoHoldAckMemoryForTests(nightKey: string | null): void {
  if (!nightKey) {
    setMemoryAck(null)
    return
  }
  setMemoryAck({ nightKey, at: new Date().toISOString() })
}
