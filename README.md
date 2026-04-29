# Pomfret Astro Observatory Platform

Production web platform for Pomfret’s remote observatory operations, including:
- public-facing astronomy pages,
- operator/admin dashboards,
- imaging session queueing,
- automatic N.I.N.A. sequence generation,
- and observatory-to-website result sync.

This repository is the control plane for request intake and orchestration. The physical capture pipeline runs on the observatory PC via `nina_agent.py`.

---

## What This System Does

At a high level:
1. A user creates an imaging session from `Dashboard > Remote`.
2. Backend validates target, weather/schedule constraints, and stores the request.
3. API serves the next N.I.N.A. sequence JSON (built from templates).
4. Observatory agent polls, downloads, executes in N.I.N.A., and reports progress/files back.
5. Dashboard shows live queue state, terminal logs, and preview/download artifacts.

Supported imaging modes:
- **Deep Sky Object (DSO)** sessions (single/multi-filter logic).
- **Variable Star** sessions (currently enforced to **G** filter for photometry consistency).

---

## Core Features

### Remote Imaging Dashboard
- Create, edit, delete, and monitor imaging sessions.
- Session type switcher (DSO / Variable Star).
- Catalog/object lookup and coordinate handling.
- “Tonight’s Schedule” visualization with weather and queue overlays.
- Current sessions board with action controls:
  - Check progress
  - Download file
  - Edit pending session
  - Delete session

### Variable Star Workflow
- Variable-star lookup endpoints and UI preview flow.
- Variable-star sequence template support in builder.
- Variable-star queue submissions normalized to `G` filter end-to-end.

### Progress + Artifact Pipeline
- Live progress stream endpoints and terminal-style viewer in UI.
- Optional preview image stream and download endpoint.
- R2 object registration and signed URL download flow.

### Admin + Safety
- Admin dashboard and schedule control endpoints.
- Session-level password checks for sensitive actions.
- Dedicated secrets for queue operations, progress ingest, R2 writes, and cleanup jobs.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router), React 18, TypeScript
- **UI:** Tailwind CSS
- **Storage:** Local file and/or Upstash KV (via REST env config)
- **Object storage:** Cloudflare R2 (S3-compatible SDK)
- **Agent-side runtime:** Python (Windows observatory host)

---

## Repository Structure

```text
app/
  api/imaging/                 # Imaging APIs (queue, progress, downloads, weather, etc.)
  dashboard/
    remote/                    # Session creation + live operations
    admin/                     # Administrative controls
    gallery/                   # Observatory image gallery
lib/
  build-nina-sequence-json.ts  # N.I.N.A. JSON template mutation/assembly
  imaging-queue-store.ts       # Queue persistence + validation logic
  r2-session-download.ts       # R2 integration for artifacts
nina_agent.py                  # Observatory-side polling + execution agent
Variables/                     # Variable-star data/catalog utilities
```

---

## Local Development

### Prerequisites
- Node.js 18+ (recommended)
- npm

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

### Build / Start

```bash
npm run build
npm run start
```

### Lint

```bash
npm run lint
```

---

## Environment Variables

Create `.env.local` (or platform-managed env vars) for the needed features:

### Queue / Auth
- `IMAGING_QUEUE_SECRET`
- `IMAGING_QUEUE_FILE` (local queue persistence path, optional if KV is used)

### Observatory status
- `OBSERVATORY_STATUS_FILE`

### Progress ingest (from observatory agent)
- `NINA_SESSION_PROGRESS_BASIC_USER`
- `NINA_SESSION_PROGRESS_BASIC_PASSWORD`
- `NINA_SESSION_END_MARKER` (optional marker customization)

### R2 artifact pipeline
- `IMAGING_R2_WRITE_SECRET`
- `R2_ENDPOINT`
- `R2_REGION` (default `auto`)
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PRESIGN_TTL_SEC` (optional)
- `R2_SESSION_OBJECT_SUFFIX` (optional)

### KV (optional shared queue backend)
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

### Scheduled cleanup / cron
- `CRON_SECRET`

> Keep all secrets out of source control. Use local env files and deployment provider secret management.

---

## Imaging API Surface (Selected)

Representative endpoints under `app/api/imaging/*`:

- `POST /api/imaging/queue` - create a session
- `PATCH /api/imaging/queue/[id]` - edit pending session
- `DELETE /api/imaging/queue/[id]` - delete session
- `GET /api/imaging/current-sessions` - queue + board view for UI
- `GET /api/imaging/nina-sequence` - observatory agent fetches next sequence
- `GET /api/imaging/queue/[id]/progress` - polled progress read
- `GET /api/imaging/queue/[id]/progress-stream` - progress stream
- `GET /api/imaging/queue/[id]/preview-stream` - preview stream
- `GET /api/imaging/download` - signed download flow
- `POST /api/imaging/session-files` - observatory reports uploaded files

---

## N.I.N.A. Sequence Generation

Sequence generation is implemented in `lib/build-nina-sequence-json.ts` and supports:
- DSO templates (single + multi-filter),
- Variable star template,
- ExoPlanets plugin target container compatibility:
  - `DeepSkyObjectContainer`
  - `ExoPlanetObjectContainer`
  - `VariableStarObjectContainer`

Important behaviors:
- Coordinates are injected directly into target fields.
- Queue/session metadata is stamped for downstream correlation.
- Variable-star requests are normalized to `G` filter.

---

## Observatory Agent (`nina_agent.py`)

The Python agent on the observatory PC:
- polls `GET /api/imaging/nina-sequence`,
- starts N.I.N.A. when a new sequence appears,
- tracks outputs in the local N.I.N.A. folder,
- uploads artifacts to R2 (if enabled),
- and POSTs session file/progress signals back to this web backend.

Operational note:
- Treat agent-side credentials/config as deployment secrets; rotate periodically.

---

## Deployment

### Vercel

Project includes:
- `npm run deploy` (`vercel --prod --yes`)

Recommended deployment flow:
1. Configure all required env vars in Vercel project settings.
2. Deploy preview and verify:
   - queue create/edit/delete
   - sequence fetch
   - progress endpoints
   - download signing
3. Promote to production.

---

## Testing Checklist (Nightly Operations)

Use this before/after clear-sky runs:

- Submit one DSO and one variable-star session.
- Verify schedule placement and current-session card rendering.
- Fetch sequence from observatory side and confirm correct target/filter.
- Confirm progress panel receives live lines.
- Confirm preview updates and download availability.
- Validate edit flow for both DSO and variable-star sessions.

---

## Troubleshooting

- **Session created but observatory does not start**
  - Check `GET /api/imaging/nina-sequence` reachability and auth.
  - Confirm agent poll loop is running.
- **Progress not showing**
  - Verify `NINA_SESSION_PROGRESS_BASIC_*` credentials match sender.
  - Check `session-progress` ingestion path and queueId mapping.
- **Download unavailable**
  - Verify R2 env vars and `IMAGING_R2_WRITE_SECRET`.
  - Check `/api/imaging/session-files` ingest success.
- **Unexpected scheduling state**
  - Verify weather prediction endpoint and admin schedule-control state.

---

## Contribution Notes

- Keep queue semantics backward-compatible with existing session records.
- For UI changes in `dashboard/remote`, verify both DSO and variable-star paths.
- Prefer strongly-typed request normalization at API boundaries.
- Run lint before commit and include a focused test plan in PR descriptions.

---

## License

Internal project repository. Use according to Pomfret Astro team policies.
