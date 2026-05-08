#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/unified-deploy/release-env.sh"

mkdir -p "$(unified_deploy_release_evidence_dir local-kind-images)" "$(dirname "$(unified_deploy_release_site_env)")"

exec npm run test:unified-deploy:local-kind:images -- \
  --evidence-dir="$(unified_deploy_release_evidence_dir local-kind-images)" \
  --out-site-env="$(unified_deploy_release_site_env)"
