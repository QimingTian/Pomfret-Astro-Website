import { emitAgentWakePollSequenceDebounced } from '@/lib/imaging/site-events'
import { listProjects } from '@/lib/imaging-project-store'
import { listPending } from '@/lib/imaging-queue-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'

/** Wake NINA agent when a scheduled session's planned start is due (or past). */
export async function maybeWakeAgentForDueScheduledSessions(now = new Date()): Promise<void> {
  const nowMs = now.getTime()
  const nightKey = getTonightScheduleStrip(now).nightKey

  for (const r of await listPending()) {
    if (r.status !== 'scheduled' || !r.plannedStartIso) continue
    const startMs = Date.parse(r.plannedStartIso)
    if (Number.isFinite(startMs) && startMs <= nowMs) {
      emitAgentWakePollSequenceDebounced()
      return
    }
  }

  for (const p of await listProjects()) {
    for (const n of p.nights) {
      if (n.nightKey !== nightKey) continue
      if (n.status !== 'scheduled' && n.status !== 'in_progress') continue
      if (!n.plannedStartIso) continue
      const startMs = Date.parse(n.plannedStartIso)
      if (Number.isFinite(startMs) && startMs <= nowMs) {
        emitAgentWakePollSequenceDebounced()
        return
      }
    }
  }
}
