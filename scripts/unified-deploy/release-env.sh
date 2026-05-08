#!/usr/bin/env bash
set -euo pipefail

UNIFIED_DEPLOY_REPO_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

unified_deploy_release_root() {
  if [[ -n "${RELEASE_CAMPAIGN_ROOT:-}" ]]; then
    printf '%s/unified-deploy\n' "${RELEASE_CAMPAIGN_ROOT}"
  else
    printf '%s/artifacts/unified-deploy\n' "${UNIFIED_DEPLOY_REPO_ROOT_DIR}"
  fi
}

unified_deploy_release_site_env() {
  printf '%s/local-kind-site.env\n' "$(unified_deploy_release_root)"
}

unified_deploy_release_evidence_dir() {
  local step="$1"
  if [[ -n "${RELEASE_CAMPAIGN_ROOT:-}" ]]; then
    printf '%s/%s\n' "$(unified_deploy_release_root)" "${step}"
  else
    printf '%s\n' "$(unified_deploy_release_root)"
  fi
}
