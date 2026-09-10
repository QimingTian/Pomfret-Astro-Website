import { neon } from '@neondatabase/serverless'

import { databaseUrl, isDatabaseConfigured } from '@/lib/db'
import { mirrorAuditLog } from '@/lib/db/mirror'
import { kvEnabled, kvGetJson } from '@/lib/kv-rest'

type Entry = {
  id: string
  at: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

function summarize(label: string, rows: Entry[]) {
  const times = rows.map((r) => r.at).filter(Boolean).sort()
  const estop = rows.filter((r) => r.kind === 'emergency_stop')
  const aroundNoon = rows.filter((r) => {
    const t = Date.parse(r.at)
    return Number.isFinite(t) && t >= Date.parse('2026-08-24T15:00:00.000Z')
  })
  console.log(
    `${label} count=${rows.length} min=${times[0] ?? 'n/a'} max=${times[times.length - 1] ?? 'n/a'} emergency_stop=${estop.length} since15:00Z=${aroundNoon.length}`
  )
  for (const r of aroundNoon.slice(-8)) {
    const event = typeof r.detail?.event === 'string' ? r.detail.event : ''
    const source = typeof r.detail?.source === 'string' ? r.detail.source : ''
    console.log(`  ${r.at} ${r.kind} ${event} ${source}`)
  }
}

async function main() {
  const write = process.argv.includes('--write')
  if (!isDatabaseConfigured() || !kvEnabled()) {
    console.error('need DATABASE_URL and KV')
    process.exit(1)
  }
  const kv = ((await kvGetJson<{ entries?: Entry[] }>('imaging-audit-log'))?.entries ?? []).filter(
    (e) => e && typeof e.id === 'string'
  )
  const sql = neon(databaseUrl())
  const pg = (await sql.query(
    'SELECT id, at::text AS at, kind, message, detail FROM audit_log'
  )) as Entry[]

  summarize('KV', kv)
  summarize('PG', pg)

  const estopKv = (await kvGetJson<Record<string, unknown>>('imaging-emergency-stop')) ?? {}
  console.log(
    `ESTOP redis phase=${String(estopKv.phase ?? 'n/a')} at=${String(estopKv.requestedAt ?? 'n/a')} by=${String(estopKv.requestedByUsername ?? 'n/a')} delivered=${estopKv.deliveredAt ? 'yes' : 'no'} cleared=${String(estopKv.clearedAt ?? 'n/a')}`
  )
  for (const r of [...kv].reverse().filter((e) => e.kind === 'emergency_stop').slice(0, 8)) {
    const d = r.detail ?? {}
    console.log(
      `  recent ${r.at} event=${String(d.event ?? '')} source=${String(d.source ?? '')} by=${String(d.requestedByUsername ?? '')}`
    )
  }

  const byId = new Map<string, Entry>()
  for (const row of [...pg, ...kv]) byId.set(row.id, row)
  const merged = Array.from(byId.values()).sort((a, b) => a.at.localeCompare(b.at))
  summarize('MERGED', merged)

  if (!write) {
    console.log('dry-run; pass --write to upsert merged rows into Postgres')
    return
  }
  await mirrorAuditLog(merged)
  console.log(`wrote ${merged.length} audit rows to Postgres`)
}

void main()
