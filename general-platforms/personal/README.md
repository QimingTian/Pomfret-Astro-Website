# Pomfret Astro — Personal Edition

Single-operator observatory: **Control Client** + **Station Agent** (Windows), talking to a **local Personal Hub** (embedded server).

## Output / storage modes

| Mode | Meaning |
|------|---------|
| `none` | Data stays on the observatory PC (no cloud upload) |
| `raw_zip` | Agent uploads session ZIP to Cloudflare R2 (optional R2 credentials) |

## Packages

| Path | Platform | Status |
|------|----------|--------|
| [`control-client/`](control-client/) | Windows (Mac dev) | MVP — dashboard, sessions, submit, settings |
| [`hub/`](hub/) | Windows / same PC | MVP — SQLite queue, agent pulse, health |
| [`station/`](station/) | Windows | MVP — Tauri dashboard, nina_agent, checks/log/settings |

## Local dev flow

```bash
# Terminal 1 — Hub
cd general-platforms/personal/hub && npm install && npm run dev

# Terminal 2 — Control Client
cd general-platforms/personal/control-client && npm run tauri dev
```

## Default Hub URL

Personal Control Client defaults to `http://127.0.0.1:7841` (local Personal Hub). Point at pomfretastro.org only for Pomfret internal testing — not the shipped Personal product.
