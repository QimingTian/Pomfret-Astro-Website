import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Stellarium Web Engine's milkyway_render uses hips_render(..., split_order=2).
// Our Atlas feeds the same HiPS survey to milkyway and DSS, but the DSS renderer
// uses a finer mesh. Match its minimum split order to prevent the image shifting
// against catalog markers as the two renderers blend at 10–20° FOV.
// Upstream: https://github.com/Stellarium/stellarium-web-engine/blob/master/src/modules/milkyway.c
// This patch is pinned to the exact bundled build; refuse unknown binaries.
const wasmPath = process.argv[2] ?? fileURLToPath(new URL('../public/stellarium/js/stellarium-web-engine.wasm', import.meta.url))
const originalHash = '00efbf7171ec1dbf39b2410f5844512d94626e2bd6fe48cd89abc8ed82466d30'
const patchedHash = 'a9f836d26926b448a1c7ad4679772698131a9eb1b7132dd9f3fe65d06d5e6a9d'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = readFileSync(wasmPath)
const hash = sha256(bytes)

if (hash === patchedHash) {
  console.log('Stellarium wide survey mesh already patched')
  process.exit(0)
}
if (hash !== originalHash) throw new Error(`Unexpected Stellarium WASM hash: ${hash}`)

// Unique sequence at the milkyway_render call to hips_render in this build:
// i32.const 0; i32.const 2; call 414. Change only split_order from 2 to 4.
const needle = Buffer.from([0x41, 0x00, 0x41, 0x02, 0x10, 0x9e, 0x03])
const at = bytes.indexOf(needle)
if (at < 0 || bytes.indexOf(needle, at + 1) >= 0) {
  throw new Error('Expected a unique wide-survey render instruction')
}
const patched = Buffer.from(bytes)
patched[at + 3] = 0x04
if (sha256(patched) !== patchedHash || !WebAssembly.validate(patched)) {
  throw new Error('Patched Stellarium WASM failed validation')
}
writeFileSync(wasmPath, patched)
console.log('Stellarium wide survey mesh raised from 2 to 4')
