#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/substrate/deploy-common.sh"

ensure_dirs
if [[ -d "${CURRENT_LINK}" ]]; then
  RELEASE_ROOT="$(cd "${CURRENT_LINK}" && pwd)"
fi
if [[ -f "${RELEASE_ROOT}/env/site.env" ]]; then
  # shellcheck disable=SC1090
  source "${RELEASE_ROOT}/env/site.env"
fi

cleanup_stale_demo_runtime_containers() {
  local name
  for name in \
    agentsmith-demo-api-1 \
    agentsmith-demo-web-1 \
    agentsmith-demo-external-runner-1; do
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

cleanup_stale_demo_runtime_containers

if demo_mode_is_full; then
  if kind get clusters 2>/dev/null | grep -qx 'agentsmith'; then
    kind delete cluster --name agentsmith || true
  fi
fi

cleanup_report_dir_artifacts "${REPORT_DIR}"
rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/* "${REPORT_DIR}"/*
state_set release.phase reset_completed
state_set reset.mode "$(demo_deploy_mode)"
log "reset ok"
