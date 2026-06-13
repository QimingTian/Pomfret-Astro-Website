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
| `STRIPE_SECRET_KEY` | Stripe secret key (enables card checkout) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`/api/checkout/webhook`) |
| `STRIPE_CHECKOUT_BASE_URL` | Optional — defaults to `https://www.boreanastro.com` for success/cancel URLs |
| Checkout payment methods | Code: `card`, `link`, `us_bank_account`, `cashapp`. Apple Pay / Google Pay: enable **Wallets** on **Card** in [Payment methods](https://dashboard.stripe.com/settings/payment_methods) |
| `STRIPE_PRICE_STANDARD_MONTHLY` | Optional Stripe Price ID — otherwise uses dynamic `price_data` |
| `STRIPE_PRICE_STANDARD_ANNUAL` | Optional Stripe Price ID for annual billing |
| `STRIPE_PRICE_STANDARD_LIFETIME` | Optional Stripe Price ID for one-time lifetime purchase |
| `LIBREWXR_API_BASE_URL` | Optional LibreWXR upstream |

## Checkout (Stripe)

1. Create products/prices in [Stripe Dashboard](https://dashboard.stripe.com) (or rely on dynamic `price_data` in dev).
2. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Vercel.
3. Add webhook endpoint: `https://www.boreanastro.com/api/checkout/webhook` — event `checkout.session.completed`.
4. Optional: set `STRIPE_PRICE_STANDARD_{MONTHLY|ANNUAL|LIFETIME}` to use dashboard Price IDs in production.

Promotion codes (100% off) still work via `/api/checkout/redeem` without Stripe.

## API routes

- `/api/personal/{tenantId}/*` — FRAOS Standard cloud hub (API path unchanged)
- `/api/imaging/*`, `/api/librewxr/*`, `/api/noaa-goes/*`, `/api/moon-svs` — Control Client content proxies
