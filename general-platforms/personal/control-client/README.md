# Pomfret Astro Control — Personal Edition

Windows desktop control client (Tauri + React). Talks to a **Personal Hub** (embedded API server — coming next), not pomfretastro.org.

## Requirements

- Node.js 20+
- Rust toolchain (for `tauri dev` / `tauri build`)
- On Windows: WebView2 (usually preinstalled on Windows 11)

## Develop

```bash
npm install
npm run tauri dev
```

## Build (Windows installer)

On a Windows machine:

```bash
npm run tauri build
```

Artifacts under `src-tauri/target/release/bundle/`.

## Settings

- Default Hub URL: `http://127.0.0.1:7841`
- Internal Pomfret testing: set Hub to `https://www.pomfretastro.org` in **Settings → Test connection**

## Output modes (Submit page)

| Mode | Storage |
|------|---------|
| `none` | Local disk on observatory PC |
| `raw_zip` | Upload ZIP to Cloudflare R2 (Station Agent) |

## Project layout

```
src/
  lib/           Hub client + settings
  pages/         Dashboard, Sessions, Submit, Settings
  components/    Layout, badges
../shared/       output-mode.ts (shared with Station later)
```
