#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TARGET_ROOT="${CLUSTER_DEPLOY_ROOT:-${HOME}/agentsmith/cluster-deploy}"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
require_supported_cluster_deploy_mode

bash "${ROOT_DIR}/scripts/cluster-deploy/publish-images.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-substrate.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-app.sh"

if [[ "$(cluster_deploy_mode)" == "full-auto" ]]; then
  bash "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
  bash "${ROOT_DIR}/scripts/cluster-deploy/apply-cluster-prereqs.sh"
  bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"
  bash "${ROOT_DIR}/scripts/cluster-deploy/bootstrap.sh"
  bash "${ROOT_DIR}/scripts/cluster-deploy/verify.sh"
  bash "${ROOT_DIR}/scripts/cluster-deploy/report.sh"
else
  bash "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
  printf '[cluster-deploy] paused for cluster administrator handoff; complete %s/admin-handoff/CHECKLIST.md, set %s/config/admin-ready.env with ADMIN_READY=1, then continue with: bash %s/scripts/cluster-deploy/deploy-sandbox.sh\n' "${TARGET_ROOT}" "${TARGET_ROOT}" "${ROOT_DIR}"
fi
