#!/usr/bin/env tsx
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildVariableStarShortlist, shortlistToCsv } from '@/lib/variable-star/shortlist'

async function main() {
  const outPath = path.join(process.cwd(), 'Variables', 'index.csv')
  console.log('Building Pomfret variable star shortlist…')
  const result = await buildVariableStarShortlist(new Date())
  const csv = shortlistToCsv(result)
  await writeFile(outPath, csv, 'utf-8')
  console.log(`Wrote ${result.stats.selected} stars → ${outPath}`)
  console.log(JSON.stringify(result.stats, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
