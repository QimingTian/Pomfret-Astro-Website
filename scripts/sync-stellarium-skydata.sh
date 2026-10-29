#!/usr/bin/env bash
# Copy Stellarium Web data + fonts into Next.js public/ so paths match a production
# Vue build with BASE_URL=/  (requests go to /skydata/... and /fonts/Roboto-*.ttf).
#
# Requires a local clone at ../third-party/stellarium-web-engine (Atlas upstream reference).
# test-skydata is the small subset shipped with stellarium-web-engine (~4.5MB).
# Plan/Atlas DSO labels do NOT use public/skydata/dso — engine.html loads the
# full survey from https://data.stellarium.org/surveys/dso (orders 0–3).
# For full Gaia depth, replace public/skydata/stars with an official dist tree.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/../third-party/stellarium-web-engine"

if [[ ! -d "$ENGINE/apps/test-skydata" ]]; then
  echo "error: missing $ENGINE/apps/test-skydata — clone https://github.com/Stellarium/stellarium-web-engine" >&2
  exit 1
fi

rm -rf "$ROOT/public/skydata"
cp -R "$ENGINE/apps/test-skydata" "$ROOT/public/skydata"
mkdir -p "$ROOT/public/fonts"
cp "$ENGINE/apps/web-frontend/public/fonts/Roboto-Regular.ttf" "$ROOT/public/fonts/"
cp "$ENGINE/apps/web-frontend/public/fonts/Roboto-Bold.ttf" "$ROOT/public/fonts/"
echo "Synced public/skydata and public/fonts (Roboto TTF)."
