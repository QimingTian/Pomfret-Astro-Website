# Pomfret Astro — Technical Documentation

> **Version:** v6.3.1  
> **Production:** [https://www.pomfretastro.org](https://www.pomfretastro.org)  
> **Release:** [v6.3.1](https://github.com/QimingTian/Pomfret-Astro-Website/releases/tag/v6.3.1)

Autonomous school observatory stack: members submit imaging requests via a Next.js web app; a server-side scheduler assigns tonight’s work; a Windows NINA agent at the dome executes sequences; results land in Cloudflare R2.

This document is **technical reference only** — architecture, algorithms, APIs, persistence, and operational contracts.

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Repository layout](#3-repository-layout)
4. [Authentication & security](#4-authentication--security)
5. [Persistence (Upstash KV)](#5-persistence-upstash-kv)
6. [Observatory status](#6-observatory-status)
7. [Weather systems](#7-weather-systems)
8. [Autonomous scheduler](#8-autonomous-scheduler)
9. [Session & project lifecycle](#9-session--project-lifecycle)
10. [NINA delivery pipeline](#10-nina-delivery-pipeline)
11. [Emergency STOP & end night](#11-emergency-stop--end-night)
12. [Project mode, mosaic & variable stars](#12-project-mode-mosaic--variable-stars)
13. [Moon avoidance](#13-moon-avoidance)
14. [All-sky camera & ASC AI](#14-all-sky-camera--asc-ai)
15. [Mount telemetry & 3D panel](#15-mount-telemetry--3d-panel)
16. [Storage (R2) & retention](#16-storage-r2--retention)
17. [Live updates & polling](#17-live-updates--polling)
18. [Cron & maintenance](#18-cron--maintenance)
19. [HTTP API reference](#19-http-api-reference)
20. [Environment variables](#20-environment-variables)
21. [NINA agent (`observatory/nina_agent.py`)](#21-nina-agent-observatorynina_agentpy)
22. [Personal tenant edition (stub)](#22-personal-tenant-edition-stub)
23. [Testing & deployment](#23-testing--deployment)

---

## 1. System overview

| Layer | Role | Runtime |
|-------|------|---------|
| **Web app** | Member UI, admin tools, scheduling API, weather gates | Vercel (Next.js 14 App Router) |
| **KV store** | Queue, projects, board, ESTOP, observatory state, audit | Upstash Redis REST |
| **Object storage** | Session FITS/ZIP, live previews, gallery | Cloudflare R2 (S3-compatible) |
| **Observatory PC** | Poll sequences, run NINA, upload R2, PDU power | Windows + `nina_agent.py` |
| **All-sky Pi** | MJPEG stream, ASC cloud/rain AI, auto exposure/WB | Raspberry Pi + `camera_service.py` |

**Observatory coordinates** (`lib/target-altitude.ts`):

- Latitude: **41°53′10″N** (41.886388…°)
- Longitude: **71°57′54″W** (−71.965°)
- Time zone: **America/New_York**

**Minimum target altitude:** **30°** for scheduling and delivery.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Vercel (Next.js)                                 │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Remote UI    │  │ Reconcile       │  │ nina-sequence GET        │  │
│  │ Plan/Weather │──│ planner         │──│ (deliver JSON / ESTOP /  │  │
│  │ Admin        │  │ weather gates   │  │  end-night)              │  │
│  └──────────────┘  └────────┬────────┘  └────────────┬─────────────┘  │
│                             │                         │                  │
│                    Upstash KV ◄────────────────────────┘                  │
│  imaging-queue-requests │ imaging-projects │ imaging-session-board       │
│  imaging-emergency-stop │ observatory-status │ imaging-audit-log         │
└─────────────────────────┬───────────────────────────┬───────────────────┘
                          │                           │
              HTTPS poll  │                           │ R2 presign / upload
                          ▼                           ▼
              ┌───────────────────────┐       ┌─────────────────┐
              │ Windows observatory PC │       │ Cloudflare R2   │
              │ nina_agent.py → NINA   │       │ imaging/{id}/…  │
              │ Digital Loggers PDU    │       └─────────────────┘
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │ Pi all-sky camera     │
              │ ASC AI + MJPEG        │
              │ cam.pomfretastro.org  │
              └───────────────────────┘
```

**Control flow (typical imaging night):**

1. Member POSTs queue row → `pending`.
2. Cron or weather poll triggers `reconcilePendingScheduleStatus()` → `scheduled` + `plannedStartIso`.
3. Agent GET `/api/imaging/nina-sequence` when Ready and `plannedStartIsDue`.
4. Agent runs NINA; POST progress to `/api/imaging/session-progress`.
5. On completion: board `completed`, reconcile next project, optionally arm end-night.
6. Agent uploads to R2; POST `/api/imaging/session-files`; member downloads via presigned URL.

---

## 3. Repository layout

```
app/
  api/                    # Route handlers (see §19)
  dashboard/              # Weather, Plan, Remote, Gallery, Admin, Account
  login/ signup/          # Auth pages
components/
  remote/                 # Remote page (schedule, sessions, ESTOP)
  plan/                   # Atlas + Framing (mosaic, NINA-aligned VIEW)
lib/
  imaging/                # Core imaging domain (see below)
  asc-cloud.ts            # ASC + Ready weather gate
  tonight-weather-gate.ts # Schedule / global permitted gates
  observatory-status-store.ts
  schedule-strip.ts       # Remote “tonight” 4pm–8am window
  sunrise-window.ts       # Nautical twilight boundaries
  moon-avoidance.ts       # Lorentzian moon separation
  kv-rest.ts              # Upstash client
  r2-session-download.ts  # R2 presign + object map
observatory/
  nina_agent.py           # Windows polling agent
  camera_service.py       # Pi MJPEG + ASC inference
  asc_cloud_ai.py         # TensorFlow.js cloud/rain models
  models/                 # Day/night cloud & rain weights
End Night Session.json    # NINA end-night template (dome close + Discord)
EStop.json                # NINA ESTOP template
```

### `lib/imaging/` module map

| Path | Responsibility |
|------|----------------|
| `project/planner.ts` | Multi-night DSO scheduling, mosaic interleave, auto-hold |
| `project/store.ts` | `ImagingProject`, `ProjectNight` persistence |
| `queue/store.ts` | `ImagingRequest` queue rows |
| `queue/reconcile.ts` | Nightly reconcile orchestration |
| `queue/schedule-insight.ts` | Single-target (non-project) placement |
| `session/board.ts` | In-progress / completed / failed board |
| `session/emergency-stop.ts` | ESTOP KV state machine (CAS) |
| `session/emergency-stop-holds.ts` | Hold/release on ESTOP |
| `session/failure.ts` | NINA-stopped detection, session fail |
| `session/failure-observatory-lock.ts` | Fail → lock + arm ESTOP |
| `session-hold.ts` | Manual / ESTOP hold & release |
| `weather-safety-estop.ts` | Auto ESTOP (storm, precip, ASC rain) |
| `planned-start-due.ts` | Delivery time gate |
| `nina-discord-message.ts` | Patch Discord text in NINA JSON trees |
| `live-bus.ts` | KV-backed live event fan-out |

Re-exports at `lib/imaging-*.ts` preserve legacy import paths.

---

## 4. Authentication & security

### Member auth

- Cookie: `pomfret_session` (httpOnly, secure in production, 90-day TTL).
- KV: `member-session:{token}` → user payload.
- Users: `member-users` with `member-email-index`, `member-username-index`.
- **Admin:** `role === 'admin'` OR email in `BOOTSTRAP_ADMIN_EMAILS`.

Helpers: `lib/member-auth.ts` — `requireUser`, `requireAdmin`, `getCurrentUser`.

### Imaging admin

Same admin check via `lib/imaging/core/admin-auth.ts` — used for ESTOP, observatory PATCH, session-control, audit-log, schedule-control mutations.

### Observatory / agent secrets

| Mechanism | Env var | Routes |
|-----------|---------|--------|
| Queue Bearer | `IMAGING_QUEUE_SECRET` | `nina-sequence`, `agent-pulse`, `session-files`, `preview` POST, `queue/[id]` PATCH, `emergency-stop/delivery` |
| Cron Bearer | `CRON_SECRET` | `reconcile-queue-schedule`, `cleanup-sessions` |
| Session progress | `NINA_SESSION_PROGRESS_BASIC_PASSWORD` (+ optional user) | `session-progress` POST |
| Mount telemetry | `NINA_MOUNT_TELEMETRY_SECRET` or Basic | `mount-pointing` POST |
| R2 manual map | `IMAGING_R2_WRITE_SECRET` | `r2-object` POST |

`lib/production-secrets.ts`: production **fail-closed** if required secrets missing; dev permissive.

### Session-scoped auth

Download, edit, delete, progress: owner match OR admin OR `x-session-password` / edit/delete credentials (`lib/imaging-session-access.ts`).

### Middleware (`middleware.ts`)

Security headers only (no auth): CSP, HSTS (prod), `X-Frame-Options`, `Permissions-Policy`. Matcher excludes `_next/static`, `stellarium/`, `skydata/`.

### Personal tenant

`PERSONAL_TENANT_SECRETS` JSON map; Bearer must match `[tenantId]` in URL (`lib/personal/tenant-auth.ts`).

---

## 5. Persistence (Upstash KV)

Enabled when `KV_REST_API_URL` + `KV_REST_API_TOKEN` set (`lib/kv-rest.ts`). API: `kvGetJson`, `kvSetJson`, `kvCompareAndSet`, `kvListPush`, `kvIncrWithExpire`, etc.

### Core keys

| Key | Module | Contents |
|-----|--------|----------|
| `imaging-queue-requests` | `queue/store.ts` | All queue rows (fallback: `IMAGING_QUEUE_FILE`) |
| `imaging-projects` | `project/store.ts` | Multi-night project records |
| `imaging-session-board` | `session/board.ts` | Active/completed board (max 50) |
| `imaging-audit-log` | `core/audit-log.ts` | Admin activity (max 400, CAS append) |
| `imaging-emergency-stop` | `session/emergency-stop.ts` | ESTOP phase + held session IDs |
| `observatory-status` | `observatory-status-store.ts` | mode, status, agent heartbeat, ninaRunning |
| `imaging-r2-object-map` | `r2-session-download.ts` | queueId → R2 object key |
| `imaging-r2-preview-map` | same | queueId → live preview key |
| `imaging-admin-closed-windows` | `admin-closed-window-store.ts` | Admin schedule blocks |
| `imaging-reconcile-last-at` | `queue/reconcile.ts` | Debounce timestamp (15 s) |

### End-night keys (per `nightKey`)

| Key pattern | Purpose |
|-------------|---------|
| `imaging-end-night-due:{nightKey}` | Armed after last session consumed |
| `imaging-end-night-sent:{nightKey}` | After-sessions shutdown delivered |
| `imaging-end-night-sent-dawn:{nightKey}` | Nautical dawn shutdown delivered |
| `imaging-end-night-estop-suppress:{nightKey}` | Block activity-only end-night after ESTOP |

### Live bus keys (`lib/imaging/live-bus.ts`)

`live:progress:{queueId}`, `live:preview:{queueId}`, `live:mount:{stationId}`, `live:site:observatory`, `live:site:sessions`, `live:site:estop`, `live:agent:wake`.

### Other

| Key | Purpose |
|-----|---------|
| `imaging-session-progress:{queueId}` | Progress line list |
| `imaging-preview-meta:{queueId}` / `imaging-preview-frame:{queueId}` | Live JPEG preview |
| `imaging-weather-safety-estop-last-arm` | Weather ESTOP debounce (45 s) |
| `imaging-queue-schedule-weather-fingerprint` | Weather column change detection |
| `observatory-nina-stopped-pending-fail` | Defer fail until progress reconciles |
| `allsky-auto-tuning-history` | Camera auto exposure/WB samples |
| `pomfret:imaging-equipment` | Rig definitions for Plan/Framing |
| `personal-hub:{tenantId}:state` | Personal edition hub (stub) |

---

## 6. Observatory status

### Modes

- **`manual`** — operator-selected status; no auto weather computation for display authority.
- **`auto`** — server computes status from rules below.

### Status values

| Status | Meaning |
|--------|---------|
| `ready` | Weather + connectivity OK; NINA may receive work |
| `busy_in_use` | NINA reported running (fresh pulse ≤ 90 s) |
| `disconnected` | No agent heartbeat ≤ 90 s |
| `closed_weather_not_permitted` | Auto weather gate failed |
| `closed_daytime` | Nautical dawn → nautical dusk |
| `closed_observatory_maintenance` | Manual maintenance or admin closed window |

### Computation (`lib/observatory-status-store.ts`)

1. Sync from KV (`syncObservatoryFromKv`) — merges agent heartbeat without reverting ESTOP lock.
2. **ESTOP guard:** while `isEmergencyStopBlocking()`, force `manual` + `closed_observatory_maintenance`; KV cannot revert to `auto`.
3. Admin closed window → maintenance.
4. Manual mode → stored manual status.
5. Daytime window → `closed_daytime`.
6. Else `evaluateObservatoryReadyWeather()` → ready or weather closed.
7. Agent disconnected → `disconnected` (overrides).
8. Fresh NINA running report → `busy_in_use`.

Persist debounced 30 s (force on mode/status change).

### Admin PATCH (`PATCH /api/imaging/observatory-status`)

Imaging admin may set `mode` and/or `status`. Clearing ESTOP: when leaving `manual + closed_observatory_maintenance` while phase is `stopped`, calls `clearEmergencyStopAfterManualUnlock()` and releases holds.

---

## 7. Weather systems

Three **independent** layers plus **display-only** astro data.

### 7.1 Observatory Ready gate (`lib/asc-cloud.ts`)

Evaluated at **delivery time** via `getObservatoryStatus()` → `isObservatoryReady()`.

| Check | Threshold |
|-------|-----------|
| Cloud (ASC applicable) | ASC AI **< 10%**, no rain |
| Cloud (ASC not applicable) | Open-Meteo `cloud_cover` **< 10%** |
| Wind | **< 10 m/s** (Open-Meteo current) |
| Precip probability | **≤ 20%** |

ASC gate **not applicable** when: all-sky sequence active, or ASC inference stale (`isAscCloudGateApplicable`).

**v6.3.1:** 7Timer transparency/seeing are **not** Ready gates — display only (§7.4).

### 7.2 Tonight schedule gate (`lib/tonight-weather-gate.ts`)

Hourly Open-Meteo at **41.9159, −71.9626** for reconcile and Remote weather column.

**Per-hour permitted** (`isHourWeatherPermitted`):

| Field | Rule |
|-------|------|
| `cloud_cover` | **< 10%** |
| `precipitation_probability` | **< 10%** |
| `wind_speed_10m` | **≤ 10 m/s** |

**Global hard block** (on imaging night sunset→sunrise):

1. Every counting hour: precip **< 10%**.
2. At most **3** hours with wind **> 10 m/s**.
3. At least **2 consecutive** hours passing all three checks.

**Forward-looking rule:** After night start, fully ended hours do not count — past bad weather cannot veto the remainder.

**Permitted intervals:** union of permitted hours, minus admin closed windows.

**Session placement:** each candidate session needs **≥ 80%** of its duration inside permitted intervals (`weatherCoverageOk(..., 0.8)`).

**Remote header** (`evaluateGlobalTonightWeatherPermitted`): gate hours = **nautical dusk → nautical dawn** only.

### 7.3 Weather-safety auto-ESTOP (`lib/imaging/weather-safety-estop.ts`)

**Nautical night only** (`isObservatoryNight`). Debounce **45 s**. Ignores in-progress session state.

| Trigger | Condition |
|---------|-----------|
| Storm approach | Open-Meteo **20 km** ring; WMO codes **95, 96, 99** at ring (not center) current or next hour |
| Site precip | Observatory hour precip probability **> 20%** |
| ASC rain | `detected === true` AND confidence **≥ 0.99** (when ASC gate applicable) |

On arm: `applyEmergencyStopHolds` → `armEmergencyStop('weather-safety-auto')` → fail in-progress sessions → `prepareEndNightAfterEstop`.

Hooks: `agent-pulse`, observatory weather refresh, schedule maintenance.

### 7.4 Display-only astro (7Timer)

`GET /api/weather/astro-conditions` → `fetchAstroConditions()` from 7Timer ASTRO API.

- Scale **1–8** (lower = better).
- All-sky overlay shows transparency/seeing; **red when ≥ 5**.
- **Not used** for Ready, schedule, or Tonight permitted since v6.3.1.

---

## 8. Autonomous scheduler

### Night boundaries

| Concept | Definition | Source |
|---------|------------|--------|
| **Schedule strip** | 4:00 PM → next 8:00 AM local; `nightKey` = strip start calendar day | `lib/schedule-strip.ts` |
| **Scheduling window** | Nautical dusk → nautical dawn | `lib/sunrise-window.ts` |
| **Open-Meteo night** | Sunset[i] → sunrise[i+1] for hourly weather | `pickOpenMeteoImagingNightBounds` |

Zenith angles (NOAA): official 90.833°, civil 96°, **nautical 102°**, astronomical 108°.

### Reconcile (`lib/imaging/queue/reconcile.ts`)

Entry: `reconcilePendingScheduleStatus({ force? })`.

- Debounce **15 s** unless `force: true`.
- **No-op** while `isEmergencyStopBlocking()`.
- Drops stale subs from prior `nightKey`.
- If weather unknown or global hard blocked → all pending **unscheduled**, clear tonight project subs.
- Else:
  1. Reconcile active on-board project first.
  2. Build FIFO free intervals (subtract altitude hold, admin force-runs, existing sub occupancy).
  3. For each pending row in **`createdAt` order**: project → `reconcileOneProjectTonight`; queue → `computeScheduleInsight`.

Runs even when pending list empty (in-progress projects need replan).

Triggered by: cron, weather prediction route, session progress completion, hold/release, observatory changes.

### Project planner (`lib/imaging/project/planner.ts`)

**Overhead** (`lib/imaging/session/overhead.ts`):

- Base **40 min** + **5 min** per extra filter + **10 min** if meridian flip.
- Variable-star sessions: **20 min** total (queue path).

**Placement:**

- Search step: **5 min**.
- Altitude: **≥ 30°** for **100%** of session duration.
- Weather: **≥ 80%** coverage in permitted intervals.
- `findPlacementStart` scans free windows; `placeSubSessionInFreeWindow` shrinks frame count if no slot.

**FIFO:**

- Parent project stays **`pending`** until NINA delivery (`markProjectOnBoard` → `in_progress`).
- Only `getNextPendingProject()` head gets new tonight subs.
- Active on-board project holds altitude ≥ 30° intervals (`lib/imaging/project/altitude-hold.ts`).

**Auto-hold after failed sub tonight:**

- `plansToScheduledNights`: if any sub tonight `failed`, new subs → `on_hold` / `onHoldFromStatus: 'scheduled'`.
- Exception: admin force-run active, or row restored to `planned` after manual release.
- ESTOP clear releases `failed_sub_tonight` holds (`releaseFailedSubTonightAutoHolds`).

**Mosaic mode:**

- `planMosaicInterleavedSubSessions`: cross-panel moon-aware interleave; picks earliest start, tie-break more frames.
- Panel coords via `projectTargetCoordsForPanel`.
- Sub indices durable across replan (excludes `scheduled` from index bump).

### Queue scheduling (`lib/imaging/queue/schedule-insight.ts`)

Same 30° / 80% weather / 5 min step / moon avoidance for non-project rows. Variable-star targets exempt from moon blocking.

### Delivery timing (`lib/imaging/planned-start-due.ts`)

```typescript
plannedStartIsDue(plannedStartIso, nowMs) // true iff now >= parsed ISO
```

Reconcile sets `plannedStartIso`; **early starts only via reconcile moving start earlier** — not transient Ready windows.

---

## 9. Session & project lifecycle

### Queue row statuses (`ImagingRequestStatus`)

`pending` | `scheduled` | `on_hold` | `in_progress` | `completed` | `failed` | `rejected`

### Project parent (`ProjectStatus`)

`pending` | `scheduled` | `in_progress` | `completed` | `failed`

Stays `pending` until first sub delivered; `completed` when no frames remain.

### Project sub-session (`ProjectNightStatus`)

`planned` | `scheduled` | `on_hold` | `in_progress` | `completed` | `failed`

| Status | Set by |
|--------|--------|
| `scheduled` | Reconcile / planner |
| `on_hold` | ESTOP, manual hold, or `failed_sub_tonight` auto-hold |
| `in_progress` | NINA delivery (`markNightInProgress`) |
| `planned` | Hold release (reconcile reuses same sub index) |
| `completed` / `failed` | Progress webhook / failure handlers |

### Session board (`lib/imaging/session/board.ts`)

Parallel **`in_progress` / `completed` / `failed`** view for Remote dashboard and delivery. Max **50** entries. Tracks download timestamps, schedule bar placement, session password hash.

### Hold / release (`lib/imaging/session-hold.ts`)

Holdable: queue `pending|scheduled`; project subs `planned|scheduled`.

Release project sub → always **`planned`** (reconcile reschedules same index).

---

## 10. NINA delivery pipeline

### `GET /api/imaging/nina-sequence` (Queue Bearer)

Priority order:

1. **`tryDeliverEmergencyStop()`** — if ESTOP stopping and not yet delivered.
2. If **`isEmergencyStopBlocking()`** → **409** (no other work).
3. If **`isNinaReportedRunningNow()`** → **409** (ESTOP-only polls until NINA stops).
4. Admin force-run delivery (if active).
5. Admin closed window → **409**.
6. Project sub-session direct delivery (on-board / awaiting sub).
7. Next **due** scheduled queue row (`plannedStartIsDue` + altitude + Ready).
8. If no row: **end-night** or **409** (imaging still scheduled / blocking).

**Consume:** normal queue rows transition `scheduled` → `in_progress` on delivery; project subs use direct JSON without consuming parent row.

### Progress webhook

`POST /api/imaging/session-progress` — optional Basic auth.

- Parses completion / ESTOP dome-closed lines.
- ESTOP `dome closed` → `markEmergencyStopCompleted`, `lockObservatoryForEmergencyStop`.
- Session completion → board/queue complete, **`await markEndNightDueIfTonightComplete()`** (reconcile first).

### NINA JSON templates

| Template | Discord message | Purpose |
|----------|-----------------|---------|
| `End Night Session.json` | `Tonight's Session Completed.` | Connect → close dome → disconnect |
| `EStop.json` | `ESTOPPED` or weather variant | Emergency dome close |

Runtime text patched via `patchNinaDiscordMessageText()` (`lib/imaging/nina-discord-message.ts`).

### Sequence JSON builder

`lib/build-nina-sequence-json.ts`, `lib/imaging/nina/sequence-json.ts` — filter plans, targets, progress URL embedded for NINA webhook.

---

## 11. Emergency STOP & end night

### ESTOP state machine (`lib/imaging/session/emergency-stop.ts`)

KV key: `imaging-emergency-stop`. Phases: **`stopping`** → **`stopped`**.

| Field | Purpose |
|-------|---------|
| `queueId` | `estop-{timestamp}` |
| `heldSessionIds` | Sessions placed on hold at arm |
| `deliveredAt` / `completedAt` | Agent delivery / dome closed |

CAS writes (`compareAndWriteState`); stale undelivered stopping cleared after **6 h**.

### Arm paths

| Source | Entry |
|--------|-------|
| Admin dashboard | `POST /api/imaging/emergency-stop` |
| Weather safety | `maybeArmWeatherSafetyEmergencyStop()` |
| Session failure | `lockObservatoryAfterSessionFailure()` (skips re-arm for `emergency_stop`, delivery handoffs) |

**On arm (v6.3.0+):**

- `lockObservatoryForEmergencyStop()` — immediate `manual` + `closed_observatory_maintenance`.
- `prepareEndNightAfterEstop(nightKey)` — clear end-night due, suppress activity-only end-night.
- Fail in-progress subs/board sessions.

### Clear ESTOP

Admin PATCH observatory leaving lock state → `clearEmergencyStopAfterManualUnlock()` → `releaseEmergencyStopHolds` + `releaseFailedSubTonightAutoHolds`.

### End night (`lib/end-night-state.ts`)

| Trigger | Queue ID | When |
|---------|----------|------|
| After last session | `end-night-{nightKey}-{ts}` | `isEndNightDue` OR (legacy) activity fallback **unless ESTOP suppressed** |
| Nautical dawn | `end-night-{nightKey}-dawn` | `now >= nauticalDawn` |

Armed by: session completion (`markEndNightDueIfTonightComplete`), last queue row consumed.

**v6.3.0 fix:** ESTOP suppresses spurious “Tonight's Session Completed” Discord when operator clears ESTOP without a normal completion.

---

## 12. Project mode, mosaic & variable stars

### Project mode

- Queue row with `projectMode: true` → parent `ImagingProject` in `imaging-projects`.
- **`remainingByFilter`**: frames left across nights; **`filterPlansTonight`**: tonight’s sub plan.
- **`onBoard`**: active altitude-FIFO holder when `in_progress`.
- Sub IDs: `{projectId}::night-{index}`.

### Mosaic

- `mosaicMode`, `mosaicPanels[]`, `mosaicRemainingByPanel`.
- Plan page Framing: Grid (H×V overlap) or Custom panels; **VIEW** projection aligned to NINA; front-hemisphere inverse on commit.
- Interleaved scheduling across panels (`planMosaicInterleavedSubSessions`).

### Variable stars

- Catalog: `lib/variable-star/` — VSX ingest, filters (CV, RR, CEP, famous), shortlist builder.
- `GET /api/imaging/variable-stars`, `/variable-star-lookup`.
- Remote: type/period filters; moon avoidance **disabled** for variable-star queue rows.
- Biweekly GitHub Action regenerates shortlist (`npm run build:variable-star-shortlist`).

---

## 13. Moon avoidance

`lib/moon-avoidance.ts` — Lorentzian model (ACP/NINA-compatible).

**Filter separation at full moon (degrees):**

| Filter | Distance |
|--------|----------|
| L, R, G, B | 110 |
| O (OIII) | 95 |
| S (SII) | 65 |
| H (Ha) | 55 |

**Width:** 14 days (half lunation). Moon below horizon → allowed. Moon alt **< 10°** → required separation × **0.5**.

Variable-star sessions skip moon checks.

---

## 14. All-sky camera & ASC AI

### Pi services

| Script | Role |
|--------|------|
| `camera_service.py` | MJPEG stream, `/camera/status`, `/camera/sequence/status` |
| `asc_cloud_ai.py` | Cloud + rain TensorFlow.js models (day/night phases) |
| `auto_exposure.py` / `auto_white_balance.py` | Solar-window-driven tuning |
| `observatory_solar.py` | Nautical dawn/dusk for camera mode |

Default stream: `https://cam.pomfretastro.org/camera/stream`.

### ASC inference payload

```typescript
{
  cloudCoverPercent: number
  rain: { detected: boolean, confidence: number, label: string }
  modelPhase: 'day' | 'night'
  frameIso: string
  stale?: boolean
  staleReason?: string
}
```

Fetched by `fetchAllSkyCamGateState()` (`lib/asc-cloud.ts`). Sequence-active → ASC gate skipped (avoid stale cloud during imaging).

### Auto-tuning history

`POST/GET /api/camera/auto-tuning-history` (admin) → KV `allsky-auto-tuning-history`.

---

## 15. Mount telemetry & 3D panel

- **POST** `/api/imaging/mount-pointing` — auth via mount secret; stores latest sample.
- **GET** `/api/imaging/mount-pointing/stream` — SSE fan-out (`live:mount:{stationId}`).
- KV: `mount-pointing:{stationId}`.
- Remote **Telescope Status** panel: Three.js GEM model from `public/telescope-models/`, driven by telemetry (`components/remote/telescope-status-panel.tsx`).

---

## 16. Storage (R2) & retention

### Layout

- Session outputs: `{R2_PREFIX}/{queueId}/…` (default prefix `imaging`).
- Live preview: `{prefix}/{queueId}/live-preview.jpg`.
- KV maps: `imaging-r2-object-map`, `imaging-r2-preview-map`.

### Upload path

Agent → boto3 upload → `POST /api/imaging/session-files` → updates KV map.

### Download

`GET /api/imaging/download` — presigned URL (`R2_PRESIGN_TTL_SEC`, default **300 s**); marks board downloaded.

### Retention (`lib/imaging-session-maintenance.ts`)

| Asset | TTL |
|-------|-----|
| Board completed / downloaded | **48 h** |
| Terminal projects (completed/failed) | **48 h** after `completedAt` |
| Member session history archive | **60 days** |
| Resolved gallery submissions | **30 days** |

Cron: `GET /api/imaging/cleanup-sessions` (Cron Bearer).

---

## 17. Live updates & polling

**Remote dashboard:** adaptive HTTP polling via `GET /api/imaging/site-poll` (member) — replaces legacy SSE for most site state.

**Legacy SSE (still present):**

- `site-stream` — observatory + sessions (+ ESTOP for admins).
- `queue/[id]/progress-stream`, `preview-stream`.
- `mount-pointing/stream`.

**Live bus:** `lib/imaging/live-bus.ts` publishes to KV lists; SSE handlers consume.

**Agent wake:** `emitAgentWake('estop')` on ESTOP arm for faster polling.

---

## 18. Cron & maintenance

| Route | Auth | Action |
|-------|------|--------|
| `GET /api/imaging/reconcile-queue-schedule` | Cron Bearer | Force reconcile |
| `GET /api/imaging/cleanup-sessions` | Cron Bearer | Reconcile + 48 h purge |

Agent may also hit reconcile URL with `POMFRET_CRON_SECRET` (`nina_agent.py`).

`lib/imaging-session-maintenance.ts`: schedule maintenance + board/project purge.

---

## 19. HTTP API reference

Auth legend: **Member**, **Admin**, **Queue**, **Cron**, **Session**, **Open**, **Tenant**.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signup` | Open | Register |
| POST | `/api/auth/login` | Open | Login → cookie |
| POST | `/api/auth/logout` | Cookie | Logout |
| GET | `/api/auth/me` | Cookie | Current user |
| POST | `/api/auth/change-password` | Member | Change password |
| GET/POST | `/api/auth/verify-email` | Token / Member | Email verification |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/members` | Admin | Member directory |
| PATCH | `/api/admin/members` | Admin | Approve imaging / roles |
| DELETE | `/api/admin/members` | Admin | Delete member |
| GET/PATCH | `/api/admin/imaging-requests` | Admin | Access & large-project approvals |
| GET/PUT/DELETE | `/api/admin/imaging-equipment` | Admin | Rig CRUD |
| GET | `/api/admin/gallery-submissions` | Admin | List submissions |
| GET | `/api/admin/gallery-submissions/[id]/preview` | Admin | Preview |
| GET | `/api/admin/gallery-submissions/[id]/download` | Admin | Download |
| POST | `/api/admin/gallery-submissions/[id]/dismiss` | Admin | Dismiss |

### Imaging — core

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/imaging/queue` | Member / Queue | List / create requests |
| PATCH/PUT/DELETE | `/api/imaging/queue/[id]` | Queue / Session | Agent update / edit / delete |
| GET | `/api/imaging/queue/[id]/nina-sequence` | Member / Queue | Preview NINA JSON |
| GET | `/api/imaging/queue/[id]/progress` | Session | Progress lines |
| GET | `/api/imaging/queue/[id]/progress-stream` | Session | SSE progress |
| GET | `/api/imaging/queue/[id]/preview-stream` | Session | SSE preview |
| GET | `/api/imaging/current-sessions` | Open | Dashboard inventory |
| GET | `/api/imaging/nina-sequence` | Queue | **Agent poll — deliver work** |
| POST | `/api/imaging/session-progress` | Basic? | NINA progress webhook |
| POST | `/api/imaging/agent-pulse` | Queue | NINA running heartbeat |
| GET | `/api/imaging/agent-events` | Open | **410 disabled** |
| GET | `/api/imaging/reconcile-queue-schedule` | Cron | Force reconcile |
| GET | `/api/imaging/cleanup-sessions` | Cron | Maintenance purge |
| GET | `/api/imaging/audit-log` | Admin | Activity log |
| GET | `/api/imaging/download` | Session | Presigned R2 URL |
| GET/POST | `/api/imaging/preview` | Session / Queue | Live preview |
| POST | `/api/imaging/session-files` | Queue | Report R2 uploads |
| POST | `/api/imaging/r2-object` | R2 secret | Manual object map |
| GET/POST | `/api/imaging/session-control` | Admin | Hold/run/fail/complete/delete |
| POST | `/api/imaging/session-schedule-placement` | Member | Schedule bar position |
| GET | `/api/imaging/equipment` | Member | List rigs |
| GET | `/api/imaging/equipment` | Member | List rigs |
| POST | `/api/imaging/visibility` | Open | Altitude check |
| GET | `/api/imaging/object-resolve` | Open | Name → coordinates |
| GET | `/api/imaging/variable-stars` | Open | Variable star catalog |
| GET | `/api/imaging/variable-star-lookup` | Open | Search catalog |
| GET | `/api/imaging/point3d-model` | Open | Telescope OBJ models |

### Imaging — observatory & weather

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/PATCH | `/api/imaging/observatory-status` | Open / Admin | Mode & status |
| GET/POST | `/api/imaging/emergency-stop` | Admin | ESTOP status / arm |
| GET | `/api/imaging/emergency-stop/delivery` | Queue | ESTOP-only poll |
| GET/POST/DELETE | `/api/imaging/schedule-control` | Open / Admin | Admin closed windows |
| GET | `/api/imaging/tonight-weather-prediction` | Open | Weather gate + column reconcile |
| GET | `/api/weather/astro-conditions` | Open | 7Timer transparency/seeing |
| GET | `/api/weather/storm-approach` | Open | Thunderstorm ring |

### Imaging — realtime

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/imaging/site-poll` | Member | Lightweight state poll |
| GET | `/api/imaging/site-stream` | Member | SSE site events |
| POST/GET | `/api/imaging/mount-pointing` | Secret / Open | Mount telemetry |
| GET | `/api/imaging/mount-pointing/stream` | Open | SSE mount |

### Member & gallery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST/DELETE | `/api/member/saved-sessions` | Member | Form drafts |
| GET | `/api/member/sessions` | Member | History archive |
| POST | `/api/member/gallery-submissions` | Member | Submit gallery |
| POST | `/api/member/gallery-submissions/[id]/upload` | Member | Upload bytes |
| POST | `/api/member/gallery-submissions/[id]/complete` | Member | Finalize |

### External proxies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/noaa-goes` | NOAA GOES image proxy |
| GET | `/api/noaa-goes/frames` | GOES frame list |
| GET | `/api/librewxr/weather-maps` | Radar metadata |
| GET | `/api/librewxr/tiles/[...path]` | Radar tiles |
| GET | `/api/moon-svs` | NASA SVS moon frames |
| POST | `/api/astrometry/solve` | Astrometry.net plate solve |
| GET/POST | `/api/camera/auto-tuning-history` | All-sky tuning (admin) |

### Personal tenant (`/api/personal/[tenantId]/`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `health` | Open | Edition probe |
| GET | `station/version` | Open | OTA version info |
| POST | `imaging/queue` | Tenant | Enqueue session |
| GET | `imaging/current-sessions` | Tenant | List sessions |
| GET | `imaging/nina-sequence` | Tenant | Stub 404 |
| POST | `imaging/agent-pulse` | Tenant | Agent heartbeat |
| GET/PATCH | `imaging/observatory-status` | Tenant | Tenant observatory |

---

## 20. Environment variables

### Required for production imaging

| Variable | Purpose |
|----------|---------|
| `KV_REST_API_URL` | Upstash REST URL |
| `KV_REST_API_TOKEN` | Upstash token |
| `IMAGING_QUEUE_SECRET` | Agent + queue Bearer |
| `CRON_SECRET` | Cron routes |
| `R2_ENDPOINT` | Cloudflare R2 endpoint |
| `R2_BUCKET` | Bucket name |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |

### Observatory & NINA

| Variable | Purpose |
|----------|---------|
| `NINA_SESSION_PROGRESS_BASIC_PASSWORD` | Progress webhook auth |
| `NINA_SESSION_PROGRESS_BASIC_USER` | Basic user (optional) |
| `NINA_SESSION_END_MARKER` | Completion signal string |
| `NINA_MOUNT_TELEMETRY_SECRET` | Mount POST auth |
| `OBSERVATORY_STATUS_FILE` | Filesystem fallback (non-Vercel) |

### Email & site

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Transactional email |
| `IMAGING_MAIL_FROM` | From address |
| `SITE_URL` / `NEXT_PUBLIC_SITE_URL` | Canonical URLs |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated admin emails |

### Optional

| Variable | Purpose |
|----------|---------|
| `IMAGING_QUEUE_FILE` | File-backed queue without KV |
| `IMAGING_R2_WRITE_SECRET` | Manual R2 map POST |
| `R2_PRESIGN_TTL_SEC` | Presign TTL (default 300) |
| `R2_PREFIX` | Object prefix (default `imaging`) |
| `ASTROMETRY_API_KEY` | Plate solve |
| `LIBREWXR_API_BASE_URL` | Radar upstream |
| `PERSONAL_TENANT_SECRETS` | JSON tenant secrets |
| `STATION_LATEST_VERSION` | Personal OTA version |

### Windows agent env

`IMAGING_QUEUE_SECRET`, `POMFRET_CRON_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `PDU_USER`, `PDU_PASSWORD`.

---

## 21. NINA agent (`observatory/nina_agent.py`)

Windows service polling `https://www.pomfretastro.org/api/imaging/nina-sequence`.

### Poll loop

| Interval | Action |
|----------|--------|
| 45 s (300 s idle) | Main sequence poll |
| 5 s | ESTOP delivery poll while NINA running |
| 30 s | Agent pulse (`ninaRunning: true`) |
| On change | Live preview JPEG upload |

### Sequence handling

1. Fingerprint JSON; skip if unchanged and NINA already running.
2. If NINA running: ESTOP poll only; kill + run ESTOP sequence if armed.
3. On new sequence: write temp JSON, PDU power (outlets 1–2, **60 s** warmup), launch NINA `--exitaftersequence`.
4. On exit: post-process (Siril stack or raw ZIP) → R2 upload → `session-files` report.

### Hardware

- **PDU:** Digital Loggers @ `192.168.121.5` — outlet 1 mount, 2 camera.
- **R2:** boto3 compatible API.

### Auth header

`Authorization: Bearer ${IMAGING_QUEUE_SECRET}`

---

## 22. Personal tenant edition (stub)

Cloud hub for personal observatory tenants — **scheduling not implemented**.

- State: `personal-hub:{tenantId}:state` (sessions + observatory snapshot).
- `nina-sequence` returns **404** “scheduling pending”.
- Intended for future on-prem hub sync.

---

## 23. Testing & deployment

### Tests

```bash
npm test          # tsx --test on lib/**/*.test.ts (253+ cases)
npm run test:types  # tsc --noEmit
```

Coverage includes: weather gates, planner auto-hold, ESTOP sync, planned-start-due, moon avoidance, reconcile fingerprints, observatory overlay.

### Local dev

```bash
npm install
npm run dev       # http://localhost:3000
```

KV optional locally (`IMAGING_QUEUE_FILE` fallback for queue).

### Production deploy

```bash
npm run deploy    # vercel --prod --yes
```

Vercel project linked to GitHub `main`. Production alias: **www.pomfretastro.org**.

### Related scripts

| Script | Purpose |
|--------|---------|
| `npm run sync:stellarium-skydata` | Sync Plan atlas sky data |
| `npm run build:variable-star-shortlist` | Regenerate VSX shortlist |
| `npm run configure:r2-gallery-cors` | R2 CORS for gallery uploads |

---

## Appendix: audit log kinds (selected)

| Kind | Source |
|------|--------|
| `emergency_stop` | Arm, deliver, complete, clear |
| `end_night` | Due, delivered |
| `observatory.patch` | Admin mode/status |
| `observatory.auto_transition` | Auto Ready ↔ closed |
| `queue.status` | Schedule, fail, complete |
| `queue.on_hold` | Hold / release |
| `session.progress` | NINA lines |
| `session.imaging_plan_changed` | Reconcile plan updates |
| `nina.delivered` | Sequence handed to agent |

Max **400** entries; read via `GET /api/imaging/audit-log` (admin).

---

## Appendix: status quick reference

### When NINA receives JSON

| Condition | Result |
|-----------|--------|
| ESTOP stopping, not delivered | ESTOP JSON |
| ESTOP blocking | 409 |
| NINA running (fresh report) | 409 (ESTOP poll only) |
| Not Ready | 409 |
| Before `plannedStartIso` | 409 (next candidate) |
| Target < 30° | Skip candidate |
| Admin closed window | 409 |
| End night due | End Night JSON |
| Else scheduled + due + Ready | Session JSON |

### Weather gate comparison

| Gate | Cloud | Precip | Wind | Astro |
|------|-------|--------|------|-------|
| Ready (ASC) | ASC < 10%, no rain | ≤ 20% | < 10 m/s | — |
| Ready (fallback) | OM < 10% | ≤ 20% | < 10 m/s | — |
| Schedule hourly | < 10% | < 10% | ≤ 10 m/s | — |
| Safety ESTOP | — | > 20% site | — | — |
| Display only | — | — | — | 7Timer 1–8 |

---

*Document generated for codebase at **v6.3.1**. For release history see [GitHub Releases](https://github.com/QimingTian/Pomfret-Astro-Website/releases).*
