#!/usr/bin/env node
/**
 * Copy built Tauri installers into website/public/releases for checkout downloads.
 * Run from repo root or standard/ after `npm run tauri build`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const standardRoot = path.resolve(__dirname, '..')
const releasesDir = path.join(standardRoot, 'website/public/releases')
const releaseJsonPath = path.join(standardRoot, 'shared/fraos-release.json')
const websiteReleaseJsonPath = path.join(standardRoot, 'website/lib/fraos-release.json')

const VERSION = '0.1.1'
const SITE = 'https://www.boreanastro.com'

const sources = [
  {
    key: 'controlMac',
    candidates: [
      path.join(
        standardRoot,
        'control-client/src-tauri/target/release/bundle/dmg/Borean Astro Control_0.1.1_aarch64.dmg'
      ),
      path.join(
        standardRoot,
        'control-client/src-tauri/target/release/bundle/dmg/Borean Astro Control_0.1.1_x64.dmg'
      ),
    ],
    dest: `borean-control-${VERSION}-macos.dmg`,
  },
  {
    key: 'controlWindows',
    candidates: [
      path.join(
        standardRoot,
        'control-client/src-tauri/target/release/bundle/nsis/Borean Astro Control_0.1.1_x64-setup.exe'
      ),
      path.join(standardRoot, 'control-client/dist-ci/Borean Astro Control_0.1.1_x64-setup.exe'),
    ],
    dest: `borean-control-${VERSION}-windows-setup.exe`,
  },
  {
    key: 'stationWindows',
    candidates: [
      path.join(standardRoot, 'station/src-tauri/target/release/bundle/nsis/Borean Astro Station_0.1.1_x64-setup.exe'),
      path.join(standardRoot, 'station/dist-ci/Borean Astro Station_0.1.1_x64-setup.exe'),
    ],
    dest: `borean-station-${VERSION}-windows-setup.exe`,
  },
]

fs.mkdirSync(releasesDir, { recursive: true })

const staged = {}

for (const item of sources) {
  const source = item.candidates.find((candidate) => fs.existsSync(candidate))
  if (!source) {
    console.warn(`skip ${item.key}: no build artifact found`)
    continue
  }
  const destPath = path.join(releasesDir, item.dest)
  fs.copyFileSync(source, destPath)
  staged[item.key] = `${SITE}/releases/${item.dest}`
  console.log(`staged ${item.key}: ${destPath} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`)
}

const release = JSON.parse(fs.readFileSync(releaseJsonPath, 'utf8'))
release.station = release.station ?? {}
release.control = release.control ?? {}
release.station.latestVersion = VERSION
release.control.latestVersion = VERSION
if (staged.stationWindows) release.station.downloadUrlWindows = staged.stationWindows
if (staged.controlMac) release.control.downloadUrlMac = staged.controlMac
if (staged.controlWindows) release.control.downloadUrlWindows = staged.controlWindows
const releaseJson = `${JSON.stringify(release, null, 2)}\n`
fs.writeFileSync(releaseJsonPath, releaseJson)
fs.writeFileSync(websiteReleaseJsonPath, releaseJson)
console.log(`updated ${releaseJsonPath}`)
console.log(`updated ${websiteReleaseJsonPath}`)
