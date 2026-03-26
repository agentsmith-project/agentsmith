#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_operator_site_env
ensure_operator_registry_env
ensure_operator_kubeconfig
export REMOTE_DEPLOY_ROOT="${CLUSTER_DEPLOY_ROOT}"
export CLUSTER_DEPLOY_ROOT
bash "${ROOT_DIR}/scripts/remote-deploy/bootstrap.sh"

