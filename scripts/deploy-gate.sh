#!/usr/bin/env bash
# Usage: bash scripts/deploy-gate.sh <current-main-sha> <quality-tested-sha>
# Both must be valid full SHA-1 object ids and match exactly.
set -euo pipefail
current="${1:-}"
tested="${2:-}"
if [[ "$current" =~ ^[0-9a-f]{40}$ && "$current" == "$tested" ]]; then
  echo 'current=true' >> "${GITHUB_OUTPUT:?}"
  echo "::notice::Deploy gate accepted tested main commit $tested"
else
  echo 'current=false' >> "${GITHUB_OUTPUT:?}"
  echo "::notice::Deploy gate skipped stale or invalid commit (main=$current, tested=$tested)"
fi
