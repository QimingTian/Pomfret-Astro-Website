import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

import { neon } from '@neondatabase/serverless'

import { databaseUrl, isDatabaseConfigured } from '@/lib/db'
import { isRedisLiveKey, REDIS_LIVE_KEYS } from '@/lib/db/data-plane'
import { kvEnabled, kvGetJson } from '@/lib/kv-rest'
import type { MemberUser } from '@/lib/member-store'

/** Leftover Redis copies of Postgres-live docs. Safe to dump; never delete Redis-live keys. */
const COLD_LEFTOVER_KEYS = [
  'member-users',
  'member-email-index',
  'member-username-index',
  'gallery-submissions',
  'pomfret:imaging-equipment',
  'imaging-r2-object-map',
  'imaging-r2-preview-map',
] as const

function backupDir(): string {
  return path.join(process.env.HOME || '.', 'Desktop', 'Pomfret-Astro-kv-backup-2026-08-24')
}

async function main() {
  if (process.argv.includes('--delete')) {
    console.error('refusing --delete: Redis-live imaging keys must stay; Postgres-live docs are not deleted from Redis by this script')
    process.exit(2)
  }
  if (!kvEnabled() || !isDatabaseConfigured()) {
    console.error('need KV and DATABASE_URL')
    process.exit(1)
  }

  const members = (await kvGetJson<{ users?: MemberUser[] }>('member-users'))?.users ?? []
  const perUser: string[] = []
  for (const u of members) {
    perUser.push(`member-saved-sessions:${u.id}`, `member-session-history:${u.id}`)
  }

  const keys = [...Object.values(REDIS_LIVE_KEYS), ...COLD_LEFTOVER_KEYS, ...perUser]
  for (const key of keys) {
    if (isRedisLiveKey(key) && process.argv.includes('--delete')) {
      throw new Error(`refusing to touch Redis-live key ${key}`)
    }
  }

  const dump: Record<string, unknown> = { savedAt: new Date().toISOString(), keys: {} }
  let bytes = 0
  for (const key of keys) {
    const value = await kvGetJson<unknown>(key)
    ;(dump.keys as Record<string, unknown>)[key] = value ?? null
    bytes += JSON.stringify(value ?? null).length
    console.log(`backup ${key} ${value == null ? 'missing' : 'ok'}`)
  }

  const sql = neon(databaseUrl())
  const counts = (await sql.query(`
    SELECT 'users' AS t, count(*)::int AS n FROM users
    UNION ALL SELECT 'queue', count(*)::int FROM imaging_requests
    UNION ALL SELECT 'projects', count(*)::int FROM imaging_projects
    UNION ALL SELECT 'board', count(*)::int FROM session_board
    UNION ALL SELECT 'audit', count(*)::int FROM audit_log
    UNION ALL SELECT 'gallery', count(*)::int FROM gallery_submissions
    UNION ALL SELECT 'equipment', count(*)::int FROM imaging_equipment
    UNION ALL SELECT 'r2', count(*)::int FROM r2_object_map
    UNION ALL SELECT 'saved', count(*)::int FROM member_saved_sessions
    UNION ALL SELECT 'history', count(*)::int FROM member_session_history
  `)) as Array<{ t: string; n: number }>
  console.log('pg', counts.map((r) => `${r.t}=${r.n}`).join(' '))

  const dir = backupDir()
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'durable-kv.json')
  await writeFile(file, JSON.stringify(dump, null, 2), 'utf8')
  console.log(`wrote ${file} ~${Math.round(bytes / 1024)}KB keys=${keys.length}`)
}

void main()
