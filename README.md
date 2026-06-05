# Pomfret Astro — repository root

This repo has two top-level folders:

| Folder | Purpose |
|--------|---------|
| **[`website-code/`](website-code/)** | Pomfret Astro website — Next.js app, observatory scripts, deploy target |
| **[`third-party/`](third-party/)** | Upstream reference clones (NINA, Siril, Stellarium, …) — local only |

**Docs:** [`website-code/README.md`](website-code/README.md) — full system guide.

**Dev:** `cd website-code && npm install && npm run dev`

**Deploy (Vercel):** set project **Root Directory** to `website-code`.
