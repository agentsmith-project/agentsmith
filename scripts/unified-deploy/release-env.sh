#!/usr/bin/env bash
set -euo pipefail

UNIFIED_DEPLOY_REPO_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

unified_deploy_release_root() {
  if [[ -n "${UNIFIED_DEPLOY_RELEASE_ROOT_DIR:-}" ]]; then
    printf '%s\n' "${UNIFIED_DEPLOY_RELEASE_ROOT_DIR}"
  elif [[ -n "${RELEASE_CAMPAIGN_ROOT:-}" ]]; then
    printf '%s/unified-deploy\n' "${RELEASE_CAMPAIGN_ROOT}"
  else
    printf '%s/artifacts/unified-deploy\n' "${UNIFIED_DEPLOY_REPO_ROOT_DIR}"
  fi
}

unified_deploy_release_site_env() {
  if [[ -n "${UNIFIED_DEPLOY_RELEASE_SITE_ENV:-}" ]]; then
    printf '%s\n' "${UNIFIED_DEPLOY_RELEASE_SITE_ENV}"
  else
    printf '%s/local-kind-site.env\n' "$(unified_deploy_release_root)"
  fi
}

unified_deploy_release_contract() {
  if [[ -n "${UNIFIED_DEPLOY_RELEASE_CONTRACT:-}" ]]; then
    printf '%s\n' "${UNIFIED_DEPLOY_RELEASE_CONTRACT}"
  elif [[ -n "${RELEASE_CAMPAIGN_ROOT:-}" ]]; then
    printf '%s/release-contract/agentsmith-release-contract.json\n' "${RELEASE_CAMPAIGN_ROOT}"
  else
    printf '%s/release-contract/agentsmith-release-contract.json\n' "${UNIFIED_DEPLOY_RELEASE_ROOT_DIR:-${UNIFIED_DEPLOY_REPO_ROOT_DIR}/artifacts}"
  fi
}

unified_deploy_release_evidence_dir() {
  local step="$1"
  if [[ -n "${RELEASE_CAMPAIGN_ROOT:-}" ]]; then
    printf '%s/%s\n' "$(unified_deploy_release_root)" "${step}"
  else
    printf '%s\n' "$(unified_deploy_release_root)"
  fi
}
