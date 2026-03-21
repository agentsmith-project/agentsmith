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
  docker_compose down -v --remove-orphans || true
fi

if kind get clusters 2>/dev/null | grep -qx 'agentsmith'; then
  kind delete cluster --name agentsmith || true
fi

rm -rf "${STATE_DIR}"/* "${LOG_DIR}"/* "${REPORT_DIR}"/*
state_set release.phase reset_completed
log "reset ok"
