#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"
ensure_backend_real_state
load_backend_real_env
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

info "running external default backend-real checks"
cleanup_gate_ports 20040 3041 e2e/integration-minimal.spec.ts
run_real_cmd \
  INTEGRATION_API_PORT=20040 \
  INTEGRATION_WEB_PORT=3041 \
  npm run test:backend-real:core

info "running notebook backend-real smoke"
cleanup_gate_ports 20060 3061 e2e/integration-system-notebook-default.spec.ts
run_real_cmd \
  INTEGRATION_API_PORT=20060 \
  INTEGRATION_WEB_PORT=3061 \
  npm run test:notebook:backend-real:smoke

info "running external codex backend-real checks"
cleanup_gate_ports 20064 3065 e2e/integration-chat-llm-runner.spec.ts
cleanup_gate_ports 20064 3065 e2e/integration-notebook-codex-runner.spec.ts
run_real_cmd \
  INTEGRATION_API_PORT=20064 \
  INTEGRATION_WEB_PORT=3065 \
  npm run test:agents:backend-real:runner

info "running file library backend-real gate"
run_real_cmd \
  FILE_LIBRARY_GATE_API_PORT=21010 \
  bash scripts/run-file-library-real-gate.sh

info "running internal notebook backend-real gate"
run_real_cmd \
  INTEGRATION_API_PORT=20072 \
  INTEGRATION_WEB_PORT=3072 \
  npm run test:internal:backend-real:notebook-workspace

state_set_string release.phase "run_completed"
state_set_string release.last_run_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backend-real-run] done"
