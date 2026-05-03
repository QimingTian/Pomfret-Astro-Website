#!/usr/bin/env node
/**
 * Pull hashed img/* URLs referenced by public/stellarium/js/app.*.js from
 * https://stellarium-web.org (same build lineage as the vendored bundle).
 * Run after replacing the Stellarium webpack bundle so toolbar / UI icons resolve.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const jsDir = path.join(root, 'public/stellarium/js')
const appGlob = fs.readdirSync(jsDir).filter((f) => /^app\.[^/]+\.js$/.test(f))
const appFile = appGlob[0] ? path.join(jsDir, appGlob[0]) : path.join(jsDir, 'app.44b5ed00.js')
const app = fs.readFileSync(appFile, 'utf8')
const re = /\.p\+"(img\/[^"]+)"/g
const files = [...new Set([...app.matchAll(re)].map((m) => m[1]))]
const destDir = path.join(root, 'public/stellarium/img')
const base = 'https://stellarium-web.org/img/'

fs.mkdirSync(destDir, { recursive: true })

for (const rel of files) {
  const name = path.basename(rel)
  const out = path.join(destDir, name)
  const url = base + name
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`fail ${name}: ${res.status}`)
    process.exitCode = 1
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(out, buf)
  console.log('wrote', rel, buf.length)
}
