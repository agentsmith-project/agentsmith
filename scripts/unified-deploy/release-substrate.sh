#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/unified-deploy/release-env.sh"

mkdir -p "$(unified_deploy_release_evidence_dir substrate)"

echo "[unified-deploy] releasing backend-real integration dependencies before unified substrate reset"
(cd "${ROOT_DIR}" && npm run integration:deps:down >/dev/null)

exec npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset \
  --profile=local-kind \
  --evidence-dir="$(unified_deploy_release_evidence_dir substrate)"
