#!/usr/bin/env bash
# Copy Stellarium Web data + fonts into Next.js public/ so paths match a production
# Vue build with BASE_URL=/  (requests go to /skydata/... and /fonts/Roboto-*.ttf).
#
# Requires a local clone at ./stellarium-web-engine (same repo as Atlas integration).
# test-skydata is the small subset shipped with stellarium-web-engine (~4.5MB).
# For full Gaia depth, replace public/skydata with the full skydata tree from an
# official stellarium-web dist build (much larger).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/stellarium-web-engine"

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
