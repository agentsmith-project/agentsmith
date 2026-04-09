#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_kubeconfig
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
load_kubeconfig

wait_cluster_app
docker_compose ps --status running universal-proxy | grep -q universal-proxy \
  || die "upgrade-status failed: universal-proxy is not running"
docker_compose ps --status running external-runner | grep -q external-runner \
  || die "upgrade-status failed: external-runner is not running"
started="$(date +%s)"
until docker logs "${COMPOSE_PROJECT_NAME:-agentsmith-cluster}-external-runner-1" 2>&1 | grep -q '\[notebook-codex-runner\] connected'; do
  if (( "$(date +%s)" - started > 120 )); then
    die "upgrade-status failed: external-runner did not reconnect in time"
  fi
  sleep 2
done
kubectl rollout status deployment/sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" --timeout=180s >/dev/null

state_set release.phase upgrade_health_checked
log "upgrade-status ok"
