import { emitLiveEvent } from '@/lib/imaging/live-bus'

export type AgentWakeType = 'estop' | 'poll_sequence' | 'reconcile'

let pollSequenceDebounce: ReturnType<typeof setTimeout> | null = null

export function emitSiteSessionsChanged(reason: string): void {
  void emitLiveEvent('site:sessions', { type: 'sessions_changed', reason })
}

export function emitAgentWake(wakeType: AgentWakeType): void {
  void emitLiveEvent('agent:wake', { type: wakeType })
}

/** Debounced queue status change → agent should poll nina-sequence once. */
export function emitAgentWakePollSequenceDebounced(): void {
  if (pollSequenceDebounce) clearTimeout(pollSequenceDebounce)
  pollSequenceDebounce = setTimeout(() => {
    pollSequenceDebounce = null
    emitAgentWake('poll_sequence')
  }, 2000)
}

export function queueStatusSignature(
  requests: Array<{ id: string; status: string }>
): string {
  return requests.map((r) => `${r.id}:${r.status}`).join('|')
}
