#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/local-kind-world.sh"
source "${ROOT_DIR}/scripts/substrate/deploy-common.sh"

ensure_dirs
if [[ -d "${CURRENT_LINK}" ]]; then
  RELEASE_ROOT="$(cd "${CURRENT_LINK}" && pwd)"
fi
if [[ -f "${RELEASE_ROOT}/env/site.env" ]]; then
  # shellcheck disable=SC1090
  source "${RELEASE_ROOT}/env/site.env"
fi

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-${LOCAL_KIND_CLUSTER_NAME:-agentsmith}}"
LOCAL_KIND_REGISTRY_NAME="${LOCAL_KIND_REGISTRY_NAME:-kind-registry}"
DEMO_KIND_CONTEXT="kind-${KIND_CLUSTER_NAME}"
DEMO_KIND_KUBECONFIG_PATH="${DEMO_KIND_KUBECONFIG_PATH:-${DEMO_DEPLOY_ROOT}/config/${DEMO_KIND_CONTEXT}.kubeconfig}"
LOCAL_KIND_STATE_ROOT="${LOCAL_KIND_STATE_ROOT:-${DEMO_DEPLOY_ROOT}/state/local-kind}"

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
  local_kind_world_destroy \
    "${KIND_CLUSTER_NAME}" \
    "${LOCAL_KIND_REGISTRY_NAME}" \
    "${LOCAL_KIND_STATE_ROOT}" \
    "${DEMO_KIND_KUBECONFIG_PATH}"
fi

# Reports are formal rehearsal evidence and must survive reset/handoff.
rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/*
state_set release.phase reset_completed
state_set reset.mode "$(demo_deploy_mode)"
log "reset ok"
