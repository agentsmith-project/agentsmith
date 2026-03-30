#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/substrate/deploy-common.sh"

ensure_dirs
load_kubeconfig || true
if [[ -d "${CURRENT_LINK}" ]]; then
  RELEASE_ROOT="$(cd "${CURRENT_LINK}" && pwd)"
fi

cleanup_stale_cluster_runtime_containers() {
  local name
  for name in \
    agentsmith-cluster-api-1 \
    agentsmith-cluster-web-1 \
    agentsmith-cluster-external-runner-1; do
    docker rm -f "${name}" >/dev/null 2>&1 || true
  done
}

if [[ -f "${RELEASE_ROOT}/compose/docker-compose.yml" ]]; then
  if [[ ! -f "${RELEASE_ROOT}/compose/.env" && -f "${RELEASE_ROOT}/VERSION" ]]; then
    APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
  fi
  docker_compose down -v --remove-orphans || true
fi

cleanup_stale_cluster_runtime_containers

cleanup_report_dir_artifacts "${REPORT_DIR}"
rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/* "${REPORT_DIR}"/*
state_set release.phase reset_completed
log "reset ok (compose and local state only; kubernetes resources were left untouched)"
