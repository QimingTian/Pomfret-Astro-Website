import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import * as schema from '@/lib/db/schema'

export function databaseUrl(): string {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    ''
  )
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl().length > 0
}

/**
 * See lib/db/data-plane.ts.
 * Postgres-live: members, gallery, equipment, R2 maps, saved sessions, history.
 * Redis-live (Postgres backup only): queue, projects, board, audit, closed windows.
 * Set POSTGRES_READ=0 to force Postgres-live docs onto leftover KV copies.
 */
export function postgresReadsEnabled(): boolean {
  if (process.env.POSTGRES_READ === '0') return false
  if (process.env.npm_lifecycle_event === 'test') return false
  return isDatabaseConfigured()
}

function createDb() {
  const url = databaseUrl()
  if (!url) throw new Error('DATABASE_URL is not configured')
  const sql = neon(url)
  return drizzle(sql, { schema })
}

let _db: ReturnType<typeof createDb> | null = null

export function getDb() {
  if (!_db) _db = createDb()
  return _db
}

export async function withDatabaseMirror(label: string, run: () => Promise<void>): Promise<void> {
  if (!isDatabaseConfigured()) return
  try {
    await run()
  } catch (error) {
    if (postgresReadsEnabled()) throw error
    console.error(`[pg-mirror] ${label} failed (KV is still source of truth)`, error)
  }
}

/** Best-effort Postgres copy. Never throws — Redis remains source of truth for hot imaging docs. */
export async function withDatabaseBackup(label: string, run: () => Promise<void>): Promise<void> {
  if (!isDatabaseConfigured()) return
  try {
    await run()
  } catch (error) {
    console.error(`[pg-backup] ${label} failed (Redis is still source of truth)`, error)
  }
}
