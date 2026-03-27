#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/bootstrap-common.sh"

ensure_operator_site_env
ensure_operator_registry_env
ensure_operator_kubeconfig
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agentsmith-cluster}"
run_deploy_bootstrap
