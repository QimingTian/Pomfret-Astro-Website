import { NextRequest, NextResponse } from 'next/server'

import { cronAuthorized } from '@/lib/cron-auth'
import { isDatabaseConfigured } from '@/lib/db'
import { backfillPostgresFromKv } from '@/lib/db/backfill'
import { applyPostgresMigrations } from '@/lib/db/migrate'

export const runtime = 'nodejs'

/**
 * Apply schema then copy current KV snapshots into Postgres.
 * KV remains the live source of truth. Requires CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'DATABASE_URL is not set; accept Neon Marketplace terms and retry install' },
      { status: 503 }
    )
  }
  const migrateOnly = request.nextUrl.searchParams.get('migrateOnly') === '1'
  if (migrateOnly) {
    const migrated = await applyPostgresMigrations()
    return NextResponse.json(migrated, { status: migrated.ok ? 200 : 500 })
  }
  const result = await backfillPostgresFromKv()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
