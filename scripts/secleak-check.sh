#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for tool in betterleaks trivy; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required security scanner is missing: $tool" >&2
    exit 2
  fi
done

node scripts/security/check-forbidden-paths.mjs --tracked
node scripts/security/check-supply-chain-policy.mjs
betterleaks git --no-banner --redact=100 --config .betterleaks.toml .
trivy fs \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --ignore-unfixed \
  --exit-code 1 \
  --skip-dirs node_modules \
  --skip-dirs .turbo \
  --skip-dirs apps/desktop/out \
  --skip-dirs apps/game-host/dist \
  --skip-dirs apps/game-host/dist-smoke \
  .
