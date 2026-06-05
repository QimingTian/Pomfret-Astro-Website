# Third-party reference (local only)

Upstream clones and reference material for Pomfret Astro development. **Not deployed** — lives beside `website-code/` in this repo.

| Folder | Purpose |
|--------|---------|
| `nina/` | NINA astronomy imaging suite source (reference) |
| `siril-1.4.2/` | Siril stacking app source (reference for CLI integration) |
| `ExoPlanets/` | NINA ExoPlanets plugin source (variable-star sequence JSON types) |
| `stellarium-web-engine/` | Stellarium Web Engine — run `website-code/scripts/sync-stellarium-skydata.sh` to copy skydata into the site |
| `emsdk/` | Emscripten SDK — only if rebuilding Stellarium WASM locally |
| `nina.plugin.template/` | Official NINA plugin Visual Studio template |
| `Nina.Point3D/` | FlyingKiwis Point3D plugin source; runtime `.obj` models ship from `website-code/public/telescope-models/` |
| `Pomfret Astro Special Event/` | Separate one-off Next app (not pomfretastro.org) |
| `reference/` | Misc screenshots / design notes |

**Website code:** [`../website-code/`](../website-code/) — see [`../website-code/README.md`](../website-code/README.md).
