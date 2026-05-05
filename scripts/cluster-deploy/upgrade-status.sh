#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
load_site_env
ensure_operator_kubeconfig
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
load_kubeconfig

wait_cluster_app
docker_compose ps --status running universal-proxy | grep -q universal-proxy \
  || die "upgrade-status failed: universal-proxy is not running"
kubectl rollout status deployment/sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" --timeout=180s >/dev/null

state_set release.phase upgrade_health_checked
log "upgrade-status ok"
