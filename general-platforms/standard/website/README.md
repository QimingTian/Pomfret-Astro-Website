# Borean Astro Website

Marketing site + cloud API for the Borean Astro generic observatory platform.

- **Production:** https://www.boreanastro.com
- **Preview:** https://boreanastro.vercel.app

## Dev

```bash
npm install
npm run dev   # http://localhost:3100
```

## Vercel env

| Variable | Purpose |
|----------|---------|
| `PERSONAL_TENANT_SECRETS` | JSON map of tenantId → Bearer secret |
| `PERSONAL_DEV_TENANT_SECRET` | Fallback for `dev-local` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis for personal hub state + provisioned tenants |
| `PERSONAL_PROMO_CODES` | JSON map of promotion codes (default dev code: `BOREAN-FIELD`) |
| `FRAOS_STATION_DOWNLOAD_URL_WINDOWS` | Station OTA installer URL |
| `FRAOS_CONTROL_DOWNLOAD_URL_WINDOWS` | Control Client OTA (Windows) |
| `FRAOS_CONTROL_DOWNLOAD_URL_MAC` | Control Client OTA (macOS) |
| `STATION_LATEST_VERSION` / `CONTROL_LATEST_VERSION` | OTA version overrides |
| `LIBREWXR_API_BASE_URL` | Optional LibreWXR upstream |

## API routes

- `/api/personal/{tenantId}/*` — FRAOS Standard cloud hub (API path unchanged)
- `/api/imaging/*`, `/api/librewxr/*`, `/api/noaa-goes/*`, `/api/moon-svs` — Control Client content proxies
