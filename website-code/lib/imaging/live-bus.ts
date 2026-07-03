import { kvEnabled, kvExpire, kvListPush, kvListRange } from '@/lib/kv-rest'

export type LiveChannel =
  | `progress:${string}`
  | `preview:${string}`
  | `mount:${string}`
  | 'site:observatory'
  | 'site:sessions'
  | 'site:estop'
  | 'agent:wake'

type LiveEnvelope = {
  id: string
  at: string
  payload: unknown
}

type Listener = (payload: unknown) => void

const LIVE_LIST_MAX = 100
const LIVE_LIST_TTL_SEC = 3600
/** Cross-instance SSE tail poll — keep ≥1s to avoid burning Redis commands on Fixed plans. */
const REDIS_TAIL_POLL_MS = 2_000

type GlobalWithLiveBus = typeof globalThis & {
  __pomfret_live_bus_listeners__?: Map<string, Set<Listener>>
  __pomfret_live_bus_seq__?: number
}

function listenersMap(): Map<string, Set<Listener>> {
  const g = globalThis as GlobalWithLiveBus
  if (!g.__pomfret_live_bus_listeners__) g.__pomfret_live_bus_listeners__ = new Map()
  return g.__pomfret_live_bus_listeners__
}

function nextEventId(): string {
  const g = globalThis as GlobalWithLiveBus
  const seq = (g.__pomfret_live_bus_seq__ ?? 0) + 1
  g.__pomfret_live_bus_seq__ = seq
  return `${Date.now()}-${seq}`
}

function redisKey(channel: LiveChannel): string {
  return `live:${channel}`
}

function notifyLocal(channel: LiveChannel, payload: unknown): void {
  const listeners = listenersMap().get(channel)
  if (!listeners || listeners.size === 0) return
  for (const listener of Array.from(listeners)) {
    try {
      listener(payload)
    } catch {
      // ignore listener failures
    }
  }
}

function parseEnvelope(raw: string): LiveEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as LiveEnvelope
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/** Fan-out to local subscribers and append to Redis list for cross-instance SSE. */
export async function emitLiveEvent(channel: LiveChannel, payload: unknown): Promise<void> {
  notifyLocal(channel, payload)
  if (!kvEnabled()) return
  const envelope: LiveEnvelope = { id: nextEventId(), at: new Date().toISOString(), payload }
  const key = redisKey(channel)
  await kvListPush(key, JSON.stringify(envelope), LIVE_LIST_MAX)
  await kvExpire(key, LIVE_LIST_TTL_SEC)
}

/**
 * Subscribe to live events on this instance. When KV is enabled, also polls Redis tail
 * for events emitted by other Vercel instances.
 */
export function subscribeLiveEvents(
  channel: LiveChannel,
  listener: Listener,
  signal?: AbortSignal
): () => void {
  const map = listenersMap()
  const set = map.get(channel) ?? new Set<Listener>()
  set.add(listener)
  map.set(channel, set)

  let stopped = false
  let seenIds = new Set<string>()
  let tailTimer: ReturnType<typeof setTimeout> | null = null

  const stopTail = () => {
    stopped = true
    if (tailTimer) clearTimeout(tailTimer)
    tailTimer = null
  }

  const pollTail = async () => {
    if (stopped || signal?.aborted) return
    if (!kvEnabled()) {
      tailTimer = setTimeout(() => void pollTail(), REDIS_TAIL_POLL_MS)
      return
    }
    try {
      const rawItems = await kvListRange(redisKey(channel), 0, 19)
      const fresh: LiveEnvelope[] = []
      for (const raw of rawItems) {
        const env = parseEnvelope(raw)
        if (!env || seenIds.has(env.id)) continue
        fresh.push(env)
      }
      fresh.reverse()
      for (const env of fresh) {
        seenIds.add(env.id)
        listener(env.payload)
      }
      if (seenIds.size > 500) {
        seenIds = new Set(Array.from(seenIds).slice(-200))
      }
    } catch {
      // ignore tail poll errors
    }
    if (!stopped && !signal?.aborted) {
      tailTimer = setTimeout(() => void pollTail(), REDIS_TAIL_POLL_MS)
    }
  }

  if (kvEnabled()) void pollTail()
  signal?.addEventListener('abort', stopTail, { once: true })

  return () => {
    stopTail()
    const current = map.get(channel)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) map.delete(channel)
  }
}

export function liveProgressChannel(queueId: string): LiveChannel {
  return `progress:${queueId}`
}

export function livePreviewChannel(queueId: string): LiveChannel {
  return `preview:${queueId}`
}

export function liveMountChannel(stationId?: string | null): LiveChannel {
  const t = typeof stationId === 'string' ? stationId.trim() : ''
  return `mount:${t.length > 0 ? t : 'default'}`
}
