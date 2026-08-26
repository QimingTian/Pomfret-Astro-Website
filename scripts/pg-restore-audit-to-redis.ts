/**
 * Rebuild Redis imaging-audit-log from Postgres (+ any Redis rows), using the
 * same progress-aware trim as lib/imaging/core/audit-log.ts.
 *
 * Usage: npx tsx scripts/pg-restore-audit-to-redis.ts
 */
import { neon } from '@neondatabase/serverless'

import { databaseUrl, isDatabaseConfigured } from '@/lib/db'
import { trimAuditEntries, type AuditLogEntry } from '@/lib/imaging/core/audit-log'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

async function main() {
  if (!isDatabaseConfigured() || !kvEnabled()) {
    console.error('need DATABASE_URL and KV')
    process.exit(1)
  }

  const kv =
    (await kvGetJson<{ entries?: AuditLogEntry[] }>('imaging-audit-log'))?.entries ?? []
  const sql = neon(databaseUrl())
  const pg = (await sql.query(
    'SELECT id, at::text AS at, kind, message, detail FROM audit_log ORDER BY at ASC'
  )) as AuditLogEntry[]

  const byId = new Map<string, AuditLogEntry>()
  for (const row of [...pg, ...kv]) {
    if (row && typeof row.id === 'string') byId.set(row.id, row)
  }
  const merged = Array.from(byId.values()).sort((a, b) => a.at.localeCompare(b.at))
  const trimmed = trimAuditEntries(merged)
  const nonProgress = trimmed.filter((e) => e.kind !== 'session.progress').length

  console.log(
    `KV in=${kv.length} PG=${pg.length} merged=${merged.length} redisOut=${trimmed.length} nonProgress=${nonProgress}`
  )

  const ok = await kvSetJson('imaging-audit-log', { entries: trimmed })
  if (!ok) {
    console.error('kvSetJson failed')
    process.exit(1)
  }
  console.log('Redis audit log restored')
}

void main()
