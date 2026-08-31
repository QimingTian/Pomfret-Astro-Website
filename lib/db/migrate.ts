import { neon } from '@neondatabase/serverless'

import { databaseUrl, isDatabaseConfigured } from '@/lib/db'
import { POSTGRES_INIT_SQL } from '@/lib/db/init-sql'

let migrationsApplied = false

/** Idempotent schema setup for Postgres. Safe to call on cold starts. */
export async function applyPostgresMigrations(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: 'DATABASE_URL is not set' }
  }
  if (migrationsApplied) return { ok: true }
  try {
    const sql = neon(databaseUrl())
    const statements = POSTGRES_INIT_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const statement of statements) {
      await sql.query(statement)
    }
    // Additive upgrades for existing databases (CREATE TABLE IF NOT EXISTS won't alter columns).
    await sql.query(
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS site_role text NOT NULL DEFAULT 'observatory_member'`
    )
    migrationsApplied = true
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'migration failed'
    return { ok: false, error: message }
  }
}
