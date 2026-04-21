#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"

info() { echo "[chat-runtime-backend-real-gate] $*"; }
die() { echo "[chat-runtime-backend-real-gate] $*" >&2; exit 1; }

load_backend_real_env
export_backend_real_endpoint_env

if [[ -z "${BACKEND_REAL_API_KEY_VALUE:-}" ]]; then
  die "missing PRESET_ENDPOINT_API_KEY in .env.backend-real"
fi

run_grep() {
  local spec="$1"
  local label="$2"
  local api_port="$3"
  local web_port="$4"
  cleanup_gate_ports "${api_port}" "${web_port}" "${spec}"
  local cmd=(bash scripts/run-integration-e2e-full.sh "${spec}")
  if [[ -n "${label}" ]]; then
    info "running ${spec} --grep ${label}"
    cmd+=(--grep "${label}")
  else
    info "running ${spec}"
  fi
  (cd "${ROOT_DIR}" && \
    INTEGRATION_API_PORT="${api_port}" \
    INTEGRATION_WEB_PORT="${web_port}" \
    "${cmd[@]}")
}

run_grep e2e/integration-chat-llm-runner.spec.ts "streams multi-turn chat through the real local chat runner and persists replies" 20061 3062
run_grep e2e/integration-chat-llm-runner.spec.ts "preserves conversation continuity across refresh with story-bound trace evidence" 20062 3063
run_grep e2e/integration-chat-llm-runner.spec.ts "warns and recreates the session workspace when the local chat workspace has been reclaimed" 20063 3064
(cd "${ROOT_DIR}" && bash scripts/run-internal-chat-real-gate.sh)
run_grep e2e/integration-membership-chat-isolation.spec.ts "" 20065 3066

info "chat runtime backend-real gate passed"
