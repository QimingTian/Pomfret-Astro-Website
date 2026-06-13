export type LiveChannel = `mount:${string}:${string}` | `agent:wake:${string}`

type Listener = (payload: unknown) => void

type GlobalWithLiveBus = typeof globalThis & {
  __borean_live_bus_listeners__?: Map<string, Set<Listener>>
}

function listenersMap(): Map<string, Set<Listener>> {
  const g = globalThis as GlobalWithLiveBus
  if (!g.__borean_live_bus_listeners__) g.__borean_live_bus_listeners__ = new Map()
  return g.__borean_live_bus_listeners__
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

export async function emitLiveEvent(channel: LiveChannel, payload: unknown): Promise<void> {
  notifyLocal(channel, payload)
}

export function subscribeLiveEvents(
  channel: LiveChannel,
  listener: Listener,
  signal?: AbortSignal
): () => void {
  const map = listenersMap()
  const set = map.get(channel) ?? new Set<Listener>()
  set.add(listener)
  map.set(channel, set)

  signal?.addEventListener(
    'abort',
    () => {
      const current = map.get(channel)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) map.delete(channel)
    },
    { once: true }
  )

  return () => {
    const current = map.get(channel)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) map.delete(channel)
  }
}

export function liveMountChannel(
  tenantId: string | undefined | null,
  stationId?: string | null
): LiveChannel {
  const tenant = typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : 'global'
  const t = typeof stationId === 'string' ? stationId.trim() : ''
  return `mount:${tenant}:${t.length > 0 ? t : 'default'}`
}

export function liveAgentWakeChannel(tenantId: string): LiveChannel {
  const tenant = tenantId.trim() || 'global'
  return `agent:wake:${tenant}`
}

export async function emitAgentWakePollSequence(tenantId: string): Promise<void> {
  await emitLiveEvent(liveAgentWakeChannel(tenantId), {
    type: 'poll_sequence',
    at: new Date().toISOString(),
  })
}
