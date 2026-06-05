import estopTemplate from '@/EStop.json'

const ESTOP_TEMPLATE = estopTemplate as Record<string, unknown>

function patchEstopHttpPost(root: Record<string, unknown>, queueId: string): void {
  const body = JSON.stringify({
    text: 'Dome Closed',
    queueId,
    PomfretAstro: { QueueId: queueId, SessionType: 'estop' },
  })

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const rec = node as Record<string, unknown>
    const type = rec.$type
    if (typeof type === 'string' && type.includes('HTTP.HttpClient')) {
      rec.HttpPostBody = body
      rec.HttpPostContentType = 'application/json'
    }
    for (const value of Object.values(rec)) walk(value)
  }

  walk(root)
}

export function estopSequenceJson(queueId: string): string {
  const root = structuredClone(ESTOP_TEMPLATE) as Record<string, unknown>
  root.Name = 'Emergency Stop'
  root.PomfretAstro = {
    QueueId: queueId,
    SessionType: 'estop',
    OutputMode: 'none',
    SessionProgressHint:
      'POST to /api/imaging/session-progress with queueId when dome is closed to clear ESTOP.',
  }
  patchEstopHttpPost(root, queueId)
  return JSON.stringify(root, null, 2)
}
