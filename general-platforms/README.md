# General Platforms (GP)

Product-line code for **Borean Astro** FRAOS installable software. Not deployed as pomfretastro.org.

| Folder | FRAOS tier | Matrix | Status |
|--------|------------|--------|--------|
| [`standard/`](standard/) | **Standard** | 1 telescope · 1 operator | Active — website, Control Client, Station |
| [`pro/`](pro/) | **Pro** | 1 telescope · team | Scaffold — development not started |
| [`max/`](max/) | **Max** | multiple telescopes · 1 operator | Scaffold — development not started |
| [`ultra/`](ultra/) | **Ultra** | multiple telescopes · organization | Scaffold — development not started |

Marketing site (all tiers): [`standard/website/`](standard/website/) → **www.boreanastro.com**

**School web app:** [`../website-code/`](../website-code/) — Pomfret-only customized deployment.

**Reference / upstream:** [`../third-party/`](../third-party/)

## Tier map

```
                 1 operator              team
         ┌────────────────────┬─────────────────────┐
 1 scope  │  standard/         │  pro/               │
         ├────────────────────┼─────────────────────┤
 N scopes │  max/              │  ultra/             │
         └────────────────────┴─────────────────────┘
```

When starting Pro, Max, or Ultra, fork patterns from `standard/` (Control Client, Station, hub, shared tenant config).
