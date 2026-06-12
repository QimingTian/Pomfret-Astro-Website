# FRAOS Max

**Multiple telescopes · one operator** — multi-site dashboard for a single owner account.

| | |
|---|---|
| Sites | Up to 5 (planned) |
| Seats | 1 |
| Status | **Not started** — scaffold only |

## When development starts

Copy the package layout from [`../standard/`](../standard/):

- `control-client/` — multi-site picker in Control Client
- `station/` — one Station per observatory site
- `hub/` — dev cloud hub with per-site tenants
- `shared/` — multi-tenant owner config
- `build-config/` — per-site `tenant.json` bundles
- `website/` — lives in `standard/website/` until Max needs separate deploy

Marketing pages: **www.boreanastro.com/fraos/max**

Each additional site provisions its own cloud hub and R2 quota — costs scale with site count.
