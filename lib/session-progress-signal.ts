/** Canonical phrase for the last observatory POST (JSON `message` or plain `text`). */
export const SESSION_COMPLETED_PHRASE = 'Session Completed'

function firstNonEmptyLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim()) ?? text).trim()
}

/**
 * Detects "session ended" from NINA / observatory HTTP POST body (JSON fields or plain text).
 */
export function isSessionCompletedSignal(detail: Record<string, unknown>): boolean {
  if (detail.sessionEnded === true) return true
  if (detail.sessionPhase === 'ended') return true
  if (detail.phase === 'ended') return true

  const marker = process.env.NINA_SESSION_END_MARKER?.trim()
  if (marker) {
    if (typeof detail.message === 'string' && detail.message.trim() === marker) return true
    if (typeof detail.text === 'string' && detail.text.trim() === marker) return true
    if (typeof detail.text === 'string' && firstNonEmptyLine(detail.text) === marker) return true
  }

  if (typeof detail.message === 'string' && detail.message.trim() === SESSION_COMPLETED_PHRASE) return true
  if (typeof detail.text === 'string') {
    const t = detail.text.trim()
    if (t === SESSION_COMPLETED_PHRASE) return true
    if (firstNonEmptyLine(detail.text) === SESSION_COMPLETED_PHRASE) return true
  }

  if (typeof detail.message === 'string' && detail.message.trim() === 'SESSION_ENDED') return true
  if (typeof detail.text === 'string' && detail.text.trim() === 'SESSION_ENDED') return true

  return false
}

export function progressLineText(detail: Record<string, unknown>): string {
  if (typeof detail.text === 'string' && detail.text.trim()) {
    const first = detail.text.split(/\r?\n/).find((l) => l.trim()) ?? detail.text
    return first.trim().slice(0, 4000)
  }
  if (typeof detail.message === 'string' && detail.message.trim()) {
    return detail.message.trim().slice(0, 4000)
  }
  if (typeof detail.step === 'string') {
    return `Step: ${detail.step}`.slice(0, 4000)
  }
  try {
    return JSON.stringify(detail).slice(0, 4000)
  } catch {
    return '(progress update)'
  }
}

function stringish(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function nestedPomfretQueueId(detail: Record<string, unknown>): string | null {
  const pa = detail.PomfretAstro
  if (pa && typeof pa === 'object' && !Array.isArray(pa)) {
    const rec = pa as Record<string, unknown>
    return (
      stringish(rec.QueueId) ??
      stringish(rec.queueId) ??
      null
    )
  }
  return null
}

/**
 * Resolves session id for routing POST lines to the per-session buffer.
 * Accepts common NINA / manual field names and `PomfretAstro.QueueId` (same as sequence JSON).
 */
export function readQueueIdFromDetail(detail: Record<string, unknown>): string | null {
  const direct =
    stringish(detail.queueId) ??
    stringish(detail.QueueId) ??
    stringish(detail.queue_id) ??
    stringish(detail.sessionId) ??
    stringish(detail.SessionId) ??
    stringish(detail.requestId) ??
    stringish(detail.RequestId) ??
    nestedPomfretQueueId(detail)
  if (direct) return direct

  return null
}
