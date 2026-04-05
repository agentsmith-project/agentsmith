#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
current="$(current_active_scenario || true)"
[[ "${current}" == "${CLUSTER_REHEARSAL_NAME}" ]] || { echo "[scenario] ERROR: cluster-rehearsal is not the active scenario." >&2; exit 1; }
cluster_require_phase bootstrap
bash "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
mark_cluster_rehearsal_admin_ready
bash "${ROOT_DIR}/scripts/cluster-deploy/apply-cluster-prereqs.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"
run_stage bootstrap
