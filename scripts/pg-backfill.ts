import { backfillPostgresFromKv } from '../lib/db/backfill'

async function main() {
  const result = await backfillPostgresFromKv()
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log('Postgres backfill from KV finished. KV remains source of truth.')
}

void main()
