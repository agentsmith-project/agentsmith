#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "remote-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  source "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  source "${ROOT_DIR}/scripts/lib/common.sh"
fi

ensure_dirs
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

if kind get clusters 2>/dev/null | grep -qx 'agentsmith'; then
  kind delete cluster --name agentsmith || true
fi

if [[ -d "${REPORT_DIR}" ]]; then
  docker run --rm \
    --user 0:0 \
    --entrypoint /bin/sh \
    -v "${REPORT_DIR}:/artifacts" \
    minio/mc:latest \
    -lc "rm -rf /artifacts/* /artifacts/.[!.]* /artifacts/..?* 2>/dev/null || true; chown -R $(id -u):$(id -g) /artifacts || true"
fi

rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/* "${REPORT_DIR}"/*
state_set release.phase reset_completed
log "reset ok"
