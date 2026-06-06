#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_cleanup_env

cleanup_local_kind_runtime() {
  local cluster_name="${LOCAL_KIND_CLUSTER_NAME:-agentsmith}"
  local registry_name="${LOCAL_KIND_REGISTRY_NAME:-kind-registry}"
  local kind_bin="${LOCAL_KIND_BIN:-}"

  if [[ -z "${kind_bin}" ]]; then
    kind_bin="$(command -v kind || true)"
  fi

  if [[ -n "${kind_bin}" ]]; then
    "${kind_bin}" delete cluster --name "${cluster_name}" >/dev/null 2>&1 || true
  fi
  if command -v docker >/dev/null 2>&1; then
    docker rm -f "${registry_name}" >/dev/null 2>&1 || true
  fi
}

if [[ -f "$(backend_real_tmp_file internal)/sandbox-control.env" ]]; then
  bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart || true
fi

APP_MODE=local-manual SUBSTRATE="${SUBSTRATE}" ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/app/down.sh"
cleanup_local_kind_runtime
reset_local_manual_state
SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/down.sh" || true
release_scenario_lock local-manual

info "done"
