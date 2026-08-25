/**
 * Durable data plane — one source of truth per document.
 *
 * Redis (Upstash) is LIVE for hot imaging docs. The website always reads these keys.
 * Postgres holds a write-through backup of the same docs, used only when a Redis key
 * is missing (never when the key exists as an empty list).
 *
 * Postgres is LIVE for members, gallery, equipment, R2 maps, saved sessions, and
 * member session history. When DATABASE_URL is set, those stores must not prefer Redis.
 *
 * Redis also holds ephemeral ops keys (observatory pulse, ESTOP, login cookies, live
 * bus). Those are not backed up to Postgres.
 *
 * Never delete REDIS_LIVE_KEYS. Never copy a missing/empty Redis hot doc over a
 * non-empty Postgres backup.
 */
export const REDIS_LIVE_KEYS = {
  queue: 'imaging-queue-requests',
  projects: 'imaging-projects',
  board: 'imaging-session-board',
  audit: 'imaging-audit-log',
  closedWindows: 'imaging-admin-closed-windows',
} as const

export const POSTGRES_LIVE = [
  'users',
  'memberships',
  'gallery_submissions',
  'imaging_equipment',
  'r2_object_map',
  'member_saved_sessions',
  'member_session_history',
] as const

export const POSTGRES_HOT_BACKUP = [
  'imaging_requests',
  'imaging_request_payloads',
  'imaging_projects',
  'session_board',
  'audit_log',
  'admin_closed_windows',
] as const

const LIVE_KEY_SET = new Set<string>(Object.values(REDIS_LIVE_KEYS))

export function isRedisLiveKey(key: string): boolean {
  return LIVE_KEY_SET.has(key)
}
