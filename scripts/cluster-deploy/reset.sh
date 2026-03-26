#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
load_kubeconfig || true
if [[ -d "${CURRENT_LINK}" ]]; then
  RELEASE_ROOT="$(cd "${CURRENT_LINK}" && pwd)"
fi

if [[ -f "${RELEASE_ROOT}/compose/docker-compose.yml" ]]; then
  if [[ ! -f "${RELEASE_ROOT}/compose/.env" && -f "${RELEASE_ROOT}/VERSION" ]]; then
    APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
    write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
  fi
  docker_compose down -v --remove-orphans || true
fi

if [[ -n "${INTERNAL_AGENT_K8S_NAMESPACE:-}" ]]; then
  kubectl delete namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" --ignore-not-found --timeout=120s >/dev/null 2>&1 || true
fi

rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/* "${REPORT_DIR}"/*
state_set release.phase reset_completed
log "reset ok"

