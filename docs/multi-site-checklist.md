# Multi-site observatory checklist

When adding a new observatory (or verifying Cygnus / Pomfret), treat **site identity** as a first-class input: geography, timezone, Redis namespace, agent poll URLs, and UI clocks must all agree.

Canonical catalog: `lib/observatory-sites.ts`  
Request scoping: `?site=<id>` / `X-Observatory-Site` / cookie → `runWithRequestSite` / `currentObservatorySite()`  
Client UI: `useObservatorySite()` + `observatorySiteFetch(...)`

---

## 1. Catalog entry (`lib/observatory-sites.ts`)

Add a site with:

| Field | Notes |
|-------|--------|
| `id` | Stable slug (`pomfret`, `cygnus`, …) |
| `name` | Display name |
| `timezone` | IANA TZ (**not** a fixed EDT/CET offset) |
| `weatherLat` / `weatherLon` | Open-Meteo, LibreWXR pin, Plan Stellarium |
| `observerLatDeg` / `observerLonDeg` | Altitude / LST / 7Timer / storm |
| `elevationMeters` | Stellarium / agent |
| `scheduleStripStartHour` / `scheduleStripEndHour` | Local wall hours for Tonight’s Schedule + Plan ribbon (e.g. Pomfret 16→08, Cygnus 15→10) |

Also update:

- `ObservatorySiteId` union
- `OBSERVATORY_SITES` / `SITES` map
- Agent Python twin: `observatory/agent_poll_schedule.py` (`AgentObservatorySite`)
- Unit tests in `lib/observatory-sites.test.ts`

---

## 2. Timezone UI checklist (no hard-coded EDT)

**Never** format user-visible times with `America/New_York` / `formatEstDateTime` unless the active site is Pomfret.

Use:

```ts
formatObservatoryDateTime(date, site.timezone)  // lib/est-datetime.ts
// or
date.toLocaleString(undefined, { timeZone: site.timezone, … })
```

| Surface | Must use active site TZ |
|---------|-------------------------|
| Weather Radar / Cloud overlay timestamp | `LibreWxrRadarMap`, `NOAAGoesCloudMap` |
| Plan ribbon markers + hover | `PlanRibbon` `timezone` prop |
| Remote Tonight’s Schedule hour labels | `getTonightScheduleStrip(now, site)` + `site.timezone` |
| Weather Tonight timeline hour labels | `lib/weather/astro-forecast.ts` |
| Completion / disconnect emails | `currentObservatorySite().timezone` |
| NINA sequence wall-clock helpers | `dateToObservatoryHms` via site ALS |
| Planner audit log labels | `currentObservatorySite().timezone` |

**Search before shipping a new site:**

```bash
rg -n "America/New_York|formatEstDateTime|EST_TIME_ZONE|OBSERVATORY_TIME_ZONE|setHours\\(16|setHours\\(8" \
  --glob '!scripts/**' --glob '!**/node_modules/**'
```

Anything that still assumes Pomfret hours (16→08) or Eastern TZ must take `site` or `currentObservatorySite()`.

---

## 3. Geography / astronomy checklist

| Concern | Source of truth |
|---------|-----------------|
| Nautical dawn/dusk, schedule strip | `lib/sunrise-window.ts`, `lib/schedule-strip.ts` — pass `site` |
| Target altitude / LST | `lib/target-altitude.ts` — must follow site observer coords |
| Tonight weather gate / Open-Meteo | `lib/tonight-weather-gate.ts`, `/api/imaging/tonight-weather-prediction` |
| 7Timer seeing/transparency | `lib/astro-conditions.ts` via site observer |
| Storm / weather-safety | site weather pin; ASC-only features stay Pomfret |

Client adaptive poll day/night (`lib/observatory-poll-schedule.ts`) should eventually take the **viewed** site’s nautical window (today still defaults via `currentObservatorySite()` / Pomfret when ALS unset).

---

## 4. Data plane / Redis

| Site | Imaging KV prefix |
|------|-------------------|
| `pomfret` | Unprefixed (`imaging-queue-requests`, …) |
| others | `site:<id>:<key>` via `observatoryKvKey` / `scopedKvKey` |

**Must** go through `scopedKvKey` (or `observatoryKvKey(currentSite, …)`), including:

- Queue (`lib/imaging/queue/store.ts`) — previously used bare `REDIS_LIVE_KEYS.queue` and Cygnus test writes polluted Pomfret
- Board / projects / ESTOP / observatory status / audit / closed windows

Verify:

- Agent polls with `?site=<id>` or `X-Observatory-Site` (env `OBSERVATORY_SITE_ID` alone only drives agent adaptive poll schedule)
- UI fetches use `observatorySiteFetch(url, siteId)`
- Unit tests that call `createRequest` **must** skip when `kvEnabled()` (live Redis)

---

## 5. Weather page product matrix

| Feature | Pomfret | Typical EU site (Cygnus) |
|---------|---------|---------------------------|
| ASC stream | Yes | Hide (no cam) |
| NOAA GOES Cloud | Yes (CONUS) | Hide |
| LibreWXR Radar | Yes | Yes (site lat/lon) |
| Conditions + Tonight strip | Optional / via ASC | Yes (`ObservatoryWeatherDashboard`) |

Radar map aspect should stay compact (`aspect-[21/9]` / max height) so it doesn’t dominate non-ASC sites.

---

## 6. Agent / ops (new site PC)

See prior Cygnus agent email notes. Minimum:

1. Copy `observatory/nina_agent.py` + templates + `agent_poll_schedule.py`
2. `OBSERVATORY_SITE_ID=<id>` **and** `?site=<id>` on all imaging URLs
3. Local NINA profile id, paths, PDU (or disable), Discord in templates
4. Shared `IMAGING_QUEUE_SECRET` + R2 (unless per-site secrets are added later)
5. Adaptive poll: night 45s / day 20min per site nautical window
6. **NINA HTTP Post URIs are injected at sequence build time** (`?site=<id>` on `/api/imaging/session-progress`). Do not hand-edit templates per site; agent job `siteId` + server ALS drive this.

---

## 7. Manual QA when flipping the site switcher

1. **Weather** — Radar timestamp shows Cygnus local (`CEST`/`CET`), not `EDT`; map centered on site; height compact  
2. **Plan** ribbon — strip length matches `scheduleStrip*` hours; marker times in site TZ  
3. **Remote** Tonight’s Schedule — same window as Plan; hour labels in site TZ  
4. **Queue** — Cygnus jobs invisible under Pomfret and vice versa  
5. **Agent** (when live) — pulse + sequence hit `site:<id>:` keys  

---

## 8. Known Pomfret-only leftovers (OK unless product asks otherwise)

- ASC / cam URLs and ASC weather-safety rain models  
- NOAA GOES CONUS cloud animation  
- Some historical docs / keynote copy that still say “Pomfret only”  
- `OBSERVATORY_TIME_ZONE` / `formatEstDateTime` aliases (deprecated; keep for Pomfret callers)

---

## 9. Member roles (backend — UI later)

| Role | Scope | Notes |
|------|--------|--------|
| Pomfret Astro Admin | Global | `users.role = pomfret_astro_admin` — all sites (ESTOP, schedule, …) |
| Observatory Admin | Per site | `memberships.site_role = observatory_admin` |
| Observatory Member | Per site | `memberships.site_role = observatory_member` |
| Guest | No membership | `site_policies.guest_access`: `closed` \| `open_direct` \| `open_approval` (+ `guest_site_access`) |

Auth helpers: `lib/member-roles.ts`, `canAdministerImagingSite`, `canSubmitImagingForSite`.  
Migration: `npx tsx scripts/migrate-member-roles.ts`

**UI reflection of roles** (directory labels, site switcher filtering, guest request UX) is a separate pass.

When in doubt: **pass `site` explicitly** rather than relying on browser locale or Pomfret defaults.
