import { applyPostgresMigrations } from '../lib/db/migrate'

async function main() {
  const result = await applyPostgresMigrations()
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log('Postgres schema applied.')
}

void main()
