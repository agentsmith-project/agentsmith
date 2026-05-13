#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"

# Preserve caller-selected first-lane ports across backend-real runtime defaults.
ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"

ensure_backend_real_state
load_backend_real_env
if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
fi
export_backend_real_endpoint_env

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  echo "[backend-real-run] Missing PRESET_ENDPOINT_API_KEY." >&2
  exit 1
fi

info() { echo "[backend-real-run] $*"; }
run_real_cmd() {
  (cd "${ROOT_DIR}" && env \
    BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
    BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL_VALUE}" \
    BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL_VALUE}" \
    BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE}" \
    "$@")
}

FIRST_LANE_API_PORT="${INTEGRATION_API_PORT:-20040}"
FIRST_LANE_WEB_PORT="${INTEGRATION_WEB_PORT:-3041}"
REUSE_DEFAULT_GATE_EVIDENCE="${BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE:-0}"

info "running default backend-real checks"
cleanup_gate_ports "${FIRST_LANE_API_PORT}" "${FIRST_LANE_WEB_PORT}" e2e/integration-minimal.spec.ts
if [[ "${REUSE_DEFAULT_GATE_EVIDENCE}" == "1" ]]; then
  info "reusing default gate evidence for shared preflight and focused visual coverage"
  run_real_cmd \
    INTEGRATION_API_PORT="${FIRST_LANE_API_PORT}" \
    INTEGRATION_WEB_PORT="${FIRST_LANE_WEB_PORT}" \
    bash scripts/workspace-project-default-gate.sh --with-backend-real --skip-shared-preflight --skip-focused-visual
else
  run_real_cmd \
    INTEGRATION_API_PORT="${FIRST_LANE_API_PORT}" \
    INTEGRATION_WEB_PORT="${FIRST_LANE_WEB_PORT}" \
    npm run test:backend-real:core
fi

info "running agent-task backend-real smoke"
cleanup_gate_ports 20060 3061 e2e/integration-agent-task-runner.spec.ts
if [[ "${REUSE_DEFAULT_GATE_EVIDENCE}" == "1" ]]; then
  run_real_cmd \
    INTEGRATION_API_PORT=20060 \
    INTEGRATION_WEB_PORT=3061 \
    AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT=1 \
    npm run test:agent-task:backend-real:smoke
else
  run_real_cmd \
    INTEGRATION_API_PORT=20060 \
    INTEGRATION_WEB_PORT=3061 \
    npm run test:agent-task:backend-real:smoke
fi

info "running agent-task runner backend-real checks"
cleanup_gate_ports 20064 3065 e2e/integration-agent-task-runner.spec.ts
run_real_cmd \
  INTEGRATION_API_PORT=20064 \
  INTEGRATION_WEB_PORT=3065 \
  npm run test:agent-task:backend-real:runner

info "running file library backend-real gate"
run_real_cmd \
  FILE_LIBRARY_GATE_API_PORT=21010 \
  bash scripts/run-file-library-real-gate.sh

info "running internal agent-task backend-real gate"
run_real_cmd \
  INTEGRATION_API_PORT=20072 \
  INTEGRATION_WEB_PORT=3072 \
  npm run test:internal:backend-real:agent-task-workspace

state_set_string release.phase "run_completed"
state_set_string release.last_run_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backend-real-run] done"
