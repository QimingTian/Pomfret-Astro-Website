#!/usr/bin/env tsx
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { OBSERVATORY_SITES, isObservatorySiteId, type ObservatorySiteId } from '@/lib/observatory-sites'
import { buildVariableStarShortlist, shortlistToCsv } from '@/lib/variable-star/shortlist'
import { variableStarCatalogRelativePath } from '@/lib/variable-star/vsx'

function parseSiteArg(argv: string[]): ObservatorySiteId[] {
  const siteFlag = argv.find((a) => a.startsWith('--site='))
  if (siteFlag) {
    const id = siteFlag.slice('--site='.length).trim()
    if (!isObservatorySiteId(id)) {
      throw new Error(`Unknown site "${id}". Use: ${OBSERVATORY_SITES.map((s) => s.id).join(', ')}`)
    }
    return [id]
  }
  return OBSERVATORY_SITES.map((s) => s.id)
}

async function main() {
  const sites = parseSiteArg(process.argv.slice(2))
  for (const siteId of sites) {
    const outPath = path.join(process.cwd(), variableStarCatalogRelativePath(siteId))
    console.log(`Building variable star shortlist for ${siteId}…`)
    const result = await buildVariableStarShortlist(new Date(), siteId)
    const csv = shortlistToCsv(result)
    await writeFile(outPath, csv, 'utf-8')
    console.log(`Wrote ${result.stats.selected} stars → ${outPath}`)
    console.log(JSON.stringify({ siteId, ...result.stats }, null, 2))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
