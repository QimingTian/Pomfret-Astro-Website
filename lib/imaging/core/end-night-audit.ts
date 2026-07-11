import { appendAuditLog } from '@/lib/imaging-audit-log'
import { isEndNightDue, markEndNightDue } from '@/lib/end-night-state'

/** Admin activity log — dedicated `end_night` kind (easy to search in Activity Log). */
export async function logEndNightDue(nightKey: string, reason: string): Promise<void> {
  if (!nightKey) return
  if (await isEndNightDue(nightKey)) return
  await markEndNightDue(nightKey)
  await appendAuditLog({
    kind: 'end_night',
    message: `End night armed — ${reason} (night ${nightKey})`,
    detail: { nightKey, event: 'due', reason },
  })
}

export async function logEndNightDelivered(input: {
  nightKey: string
  queueId: string
  trigger: 'after_sessions' | 'nautical_dawn'
}): Promise<void> {
  const label = input.trigger === 'after_sessions' ? 'after last session' : 'at nautical dawn'
  await appendAuditLog({
    kind: 'end_night',
    message: `End night sequence delivered to NINA (${label}): ${input.queueId}`,
    detail: {
      nightKey: input.nightKey,
      queueId: input.queueId,
      trigger: input.trigger,
      event: 'delivered',
    },
  })
}
