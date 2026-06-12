# FRAOS Pro

**One telescope · your team** — multi-seat access to a single observatory.

| | |
|---|---|
| Sites | 1 |
| Seats | Up to 10 (planned) |
| Status | **Not started** — scaffold only |

## When development starts

Copy the package layout from [`../standard/`](../standard/):

- `control-client/` — team-aware Control Client
- `station/` — same Station agent as Standard (one site)
- `hub/` — dev cloud hub with RBAC
- `shared/` — tenant + org config
- `build-config/` — per-customer baked identity
- `website/` — lives in `standard/website/` until Pro needs separate deploy

Marketing pages: **www.boreanastro.com/fraos/pro**

Reference implementation for multi-user observatory: [`../../website-code/`](../../website-code/) (Pomfret).
