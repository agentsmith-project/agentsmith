#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/runner-lifecycle-log.sh"

ensure_dirs
load_site_env
ensure_operator_kubeconfig
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
load_kubeconfig

wait_cluster_app
docker_compose ps --status running universal-proxy | grep -q universal-proxy \
  || die "upgrade-status failed: universal-proxy is not running"
docker_compose ps --status running external-runner | grep -q external-runner \
  || die "upgrade-status failed: external-runner is not running"
started="$(date +%s)"
until runner_lifecycle_logs_connected "$(docker logs "${COMPOSE_PROJECT_NAME:-agentsmith-cluster}-external-runner-1" 2>&1 || true)"; do
  if (( "$(date +%s)" - started > 120 )); then
    die "upgrade-status failed: external-runner did not reconnect in time"
  fi
  sleep 2
done
kubectl rollout status deployment/sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" --timeout=180s >/dev/null

state_set release.phase upgrade_health_checked
log "upgrade-status ok"
