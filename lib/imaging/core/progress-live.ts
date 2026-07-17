import { emitLiveEvent, liveProgressChannel } from '@/lib/imaging/live-bus'
import { appendSessionProgressLine } from '@/lib/imaging/core/session-progress-store'

export type LiveProgressEvent =
  | { type: 'line'; at: string; text: string }
  | { type: 'status'; queueStatus: string }

type Listener = (event: LiveProgressEvent) => void

type GlobalWithProgressBus = typeof globalThis & {
  __pomfret_imaging_progress_listeners__?: Map<string, Set<Listener>>
}

function listenersMap(): Map<string, Set<Listener>> {
  const g = globalThis as GlobalWithProgressBus
  if (!g.__pomfret_imaging_progress_listeners__) {
    g.__pomfret_imaging_progress_listeners__ = new Map<string, Set<Listener>>()
  }
  return g.__pomfret_imaging_progress_listeners__
}

export function subscribeProgress(queueId: string, listener: Listener): () => void {
  const map = listenersMap()
  const listeners = map.get(queueId) ?? new Set<Listener>()
  listeners.add(listener)
  map.set(queueId, listeners)

  return () => {
    const current = map.get(queueId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) map.delete(queueId)
  }
}

export function publishProgress(queueId: string, event: LiveProgressEvent): void {
  if (event.type === 'line') {
    void appendSessionProgressLine(queueId, { at: event.at, text: event.text })
  }
  const listeners = listenersMap().get(queueId)
  if (listeners && listeners.size > 0) {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event)
      } catch {
        // ignore listener failures
      }
    }
  }
  void emitLiveEvent(liveProgressChannel(queueId), event)
}
