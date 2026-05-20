export type AuditLogRowLike = {
  id: string
  at: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

const FAILED_KINDS = new Set([
  'queue.rejected',
  'queue.create_failed',
])
const FAILED_MESSAGE_RE = /fail|rejected|unauthorized|error/i

export function auditLogLineFailed(row: AuditLogRowLike): boolean {
  if (FAILED_KINDS.has(row.kind)) return true
  if (row.kind === 'queue.status' && FAILED_MESSAGE_RE.test(row.message)) return true
  if (row.kind === 'project.sub_session_unscheduled') return false
  return FAILED_MESSAGE_RE.test(row.message) && !/completed|scheduled/i.test(row.message)
}

/** One-line headline for the log list (Check Progress terminal style). */
export function auditLogHeadline(row: AuditLogRowLike): string {
  const scheduled = row.message.match(
    /sub-session scheduled:\s*(.+?)\s+Session\s+(\d+)/i
  )
  if (scheduled) return `Session ${scheduled[2]} scheduled — ${scheduled[1].trim()}`

  const unscheduled = row.message.match(
    /sub-session unscheduled:\s*(.+?)\s+Session\s+(\d+)/i
  )
  if (unscheduled) return `Session ${unscheduled[2]} unscheduled — ${unscheduled[1].trim()}`

  const delivered = row.message.match(/sub-session delivered:\s*(.+?)\s+Session\s+(\d+)/i)
  if (delivered) return `NINA delivered Session ${delivered[2]} — ${delivered[1].trim()}`

  const nightCompleted = row.message.match(/sub-session\s+(.+?::night-\d+)\s+completed/i)
  if (nightCompleted) return `Session completed — ${nightCompleted[1]}`

  const movedPending = row.message.match(/Session\s+(\S+)\s+moved from scheduled/i)
  if (movedPending) return `Queue unscheduled — ${movedPending[1]}`

  const scheduling = row.message.match(/Scheduling decision for\s+(\S+):\s*(.+)$/i)
  if (scheduling) return `Schedule: ${scheduling[2]} — ${scheduling[1]}`

  const edited = row.message.match(/Pending session edited:\s*(.+?)\s+\(/i)
  if (edited) return `Session edited — ${edited[1].trim()}`

  const created = row.message.match(/Imaging (?:queue )?session (?:created|submitted):\s*(.+?)\s+\(/i)
  if (created) return `Session created — ${created[1].trim()}`

  if (row.kind === 'nina.delivered') {
    const short = row.message.replace(/^NINA project sub-session delivered:\s*/i, 'NINA delivered — ')
    return short.length > 100 ? `${short.slice(0, 97)}…` : short
  }

  const plain = row.message.replace(/\s+/g, ' ').trim()
  return plain.length > 110 ? `${plain.slice(0, 107)}…` : plain
}

export type AuditDetailField = { label: string; value: string }

function stringish(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v, null, 2)
}

/** Flatten detail for the detail modal (reasons expanded, nested JSON pretty). */
export function auditLogDetailFields(row: AuditLogRowLike): AuditDetailField[] {
  const fields: AuditDetailField[] = [
    { label: 'Time (UTC)', value: row.at.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') },
    {
      label: 'Time (local)',
      value: Number.isFinite(Date.parse(row.at)) ? new Date(row.at).toLocaleString() : row.at,
    },
    { label: 'Kind', value: row.kind },
    { label: 'Message', value: row.message },
  ]

  const d = row.detail
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fields

  const reasons = d.reasons
  if (Array.isArray(reasons)) {
    reasons.forEach((r, i) => {
      fields.push({ label: `Reason ${i + 1}`, value: stringish(r) })
    })
  }

  const skip = new Set(['reasons'])
  for (const [key, value] of Object.entries(d)) {
    if (skip.has(key)) continue
    if (value == null) continue
    if (typeof value === 'object') {
      fields.push({ label: key, value: JSON.stringify(value, null, 2) })
    } else {
      fields.push({ label: key, value: stringish(value) })
    }
  }

  return fields
}
