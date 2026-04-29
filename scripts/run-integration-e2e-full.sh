#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/lane-run-state.sh"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/lib/universal-proxy-runtime.sh"

SPEC_FILE="${1:-e2e/integration-chat.spec.ts}"
shift || true

ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
ORIGINAL_INTEGRATION_BASE_URL="${INTEGRATION_BASE_URL:-}"
ORIGINAL_INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-}"
ORIGINAL_BACKEND_REAL_STATE_DIR="${BACKEND_REAL_STATE_DIR:-}"

load_backend_real_env "${ROOT_DIR}/.env.backend-real"
export_backend_real_endpoint_env

if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_BASE_URL}" ]]; then
  export INTEGRATION_BASE_URL="${ORIGINAL_INTEGRATION_BASE_URL}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_API_BASE}" ]]; then
  export INTEGRATION_API_BASE="${ORIGINAL_INTEGRATION_API_BASE}"
fi
if [[ -n "${ORIGINAL_BACKEND_REAL_STATE_DIR}" ]]; then
  export BACKEND_REAL_STATE_DIR="${ORIGINAL_BACKEND_REAL_STATE_DIR}"
fi

export BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY:-${BACKEND_REAL_API_KEY_VALUE:-}}"
export BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL:-${BACKEND_REAL_MODEL_VALUE:-}}"
export BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL:-${BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE:-}}"
export BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL:-${BACKEND_REAL_OPENAI_BASE_URL_VALUE:-}}"

# Always clear proxy-related env vars for deterministic local integration/e2e testing.
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_PORT="${INTEGRATION_API_PORT:-20000}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3001}"
POSTGRES_PORT="${POSTGRES_PORT:-${INTEGRATION_POSTGRES_PORT:-25432}}"
MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-27027}}"
REDIS_PORT="${REDIS_PORT:-${INTEGRATION_REDIS_PORT:-26379}}"
MINIO_API_PORT="${MINIO_API_PORT:-${INTEGRATION_MINIO_API_PORT:-29000}}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-${INTEGRATION_MINIO_CONSOLE_PORT:-29001}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-28081}}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-$([[ -n "${SANDBOX_MANAGER_URL:-}" ]] && printf 'external_host,internal_k8s' || printf 'external_host')}"
ensure_backend_real_state
INTEGRATION_RUN_ID="${INTEGRATION_RUN_ID:-$(lane_generate_run_id integration)}"
INTEGRATION_RUN_ROOT="${INTEGRATION_RUN_ROOT:-$(lane_prepare_run_root backend-real "${INTEGRATION_RUN_ID}" current-run)}"
UX_TRACE_OUTPUT_ROOT="${UX_TRACE_OUTPUT_ROOT:-${INTEGRATION_RUN_ROOT}/ux-traces}"
INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-${INTEGRATION_RUN_ROOT}/integration}"
export CURRENT_GATE_RESULT_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-lane-backend-real-core}"
export CURRENT_GATE_RESULT_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-lane:backend-real:core}"
export CURRENT_GATE_RESULT_CI_JOB="${CURRENT_GATE_RESULT_CI_JOB:-lane-backend-real-core}"
export CURRENT_GATE_RESULT_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-backend_real}"
export RUNTIME_LINE_ID="${RUNTIME_LINE_ID:-$(basename "${INTEGRATION_RUN_ROOT}")}"
export UX_TRACE_OUTPUT_ROOT
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "mbos" "agentsmith"
# Use 127.0.0.1 for the isolated integration Keycloak lane so browser cookies do not collide
# with any other localhost-scoped Keycloak session already running on this machine.
export RUNTIME_BROWSER_KEYCLOAK_BASE_URL="http://127.0.0.1:${KEYCLOAK_PORT}"
export RUNTIME_HOST_KEYCLOAK_BASE_URL="http://127.0.0.1:${KEYCLOAK_PORT}"
export KEYCLOAK_BASE_URL="${RUNTIME_BROWSER_KEYCLOAK_BASE_URL}"
export KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms"
export PUBLIC_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}"
export INTERNAL_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}"
export KEYCLOAK_ISSUER_URL="${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}"
PLAYWRIGHT_BASE_URL="${INTEGRATION_BASE_URL:-${RUNTIME_BROWSER_WEB_BASE_URL}}"
INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"

BOOTSTRAP_DEPS="${INTEGRATION_BOOTSTRAP_DEPS:-true}"
INIT_DEPS="${INTEGRATION_INIT_DEPS:-true}"

mkdir -p "${INTEGRATION_LOG_DIR}"
lane_prepare_alias_link "${INTEGRATION_LOG_DIR}" "$(backend_real_state_root)/integration"
gate_evidence_init "${INTEGRATION_LOG_DIR}" "backend_real"
gate_write_runtime_descriptor "${INTEGRATION_LOG_DIR}" "backend_real"
gate_write_resolved_env "${INTEGRATION_LOG_DIR}"
gate_record_task_summary "${INTEGRATION_LOG_DIR}" "{\"line_kind\":\"backend_real\",\"spec_file\":\"${SPEC_FILE}\",\"api_port\":\"${API_PORT}\",\"web_port\":\"${WEB_PORT}\"}"
API_LOG="${INTEGRATION_API_LOG:-${INTEGRATION_LOG_DIR}/api.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-${INTEGRATION_LOG_DIR}/web.log}"
NEXT_WEB_PID_FILE="${INTEGRATION_RUN_ROOT}/next-dev.pid"
NEXT_WEB_PROCESS_STATE_FILE="${INTEGRATION_RUN_ROOT}/web.process.json"
NEXT_DEV_EXIT_MARKER_FILE="${INTEGRATION_RUN_ROOT}/next-dev-exit.json"
NEXT_DIST_DIR="${INTEGRATION_NEXT_DIST_DIR:-artifacts/backend-real/runs/${INTEGRATION_RUN_ID}/next-dist}"
INTEGRATION_LIFECYCLE_ARTIFACT_DIR="${INTEGRATION_LIFECYCLE_ARTIFACT_DIR:-$(backend_real_state_root)/integration-lifecycle/${INTEGRATION_RUN_ID}}"
next_generated_root_normalize
next_generated_root_write_lane_owner "${INTEGRATION_RUN_ROOT}" "backend-real" "$$" "run-integration-e2e-full.sh"
API_PID=""
WEB_PID=""
PROXY_PID=""
PLAYWRIGHT_PID=""
PLAYWRIGHT_STATUS=0
KEEP_FAILED_ENV="${INTEGRATION_KEEP_FAILED_ENV:-0}"
BACKEND_REAL_KEEP_RUNS="${BACKEND_REAL_KEEP_RUNS:-5}"

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${INTEGRATION_LOG_DIR}" "${service_name}" "${status}" "${detail}"
}


run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

run_clean_with_integration_env() {
  run_clean env \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    INTEGRATION_BASE_URL="${PLAYWRIGHT_BASE_URL}" \
    INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    KEYCLOAK_URL="${KEYCLOAK_URL}" \
    KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
    PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
    INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
    KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
    DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}" \
    MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}" \
    MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
    REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}" \
    MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
    MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}" \
    MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
    MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
    POSTGRES_PORT="${POSTGRES_PORT:-}" \
    MONGO_PORT="${MONGO_PORT:-}" \
    REDIS_PORT="${REDIS_PORT:-}" \
    MINIO_API_PORT="${MINIO_API_PORT:-}" \
    MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-}" \
    KEYCLOAK_PORT="${KEYCLOAK_PORT:-}" \
    "$@"
}

start_background_job() {
  local log_file="$1"
  shift
  "$@" >"${log_file}" 2>&1 &
  echo $!
}

kill_process_tree() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  local child
  while read -r child; do
    [[ -n "${child}" ]] || continue
    kill_process_tree "${child}"
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -TERM "${pid}" >/dev/null 2>&1 || true
}

stop_background_job() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  kill_process_tree "${pid}"

  for _ in $(seq 1 10); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  while read -r child; do
    [[ -n "${child}" ]] || continue
    kill -KILL "${child}" >/dev/null 2>&1 || true
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -KILL "${pid}" >/dev/null 2>&1 || true
}

curl_status() {
  local url="$1"
  curl -s -o /dev/null -w "%{http_code}" "${url}" || true
}

lane_owner_field_value() {
  local file_path="$1"
  local field_name="$2"
  [[ -f "${file_path}" ]] || return 0
  sed -n "s/^${field_name}=//p" "${file_path}" | head -n 1
}

pid_is_alive() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1
}

capture_integration_lifecycle_observation() {
  local phase="$1"
  local output_file="${INTEGRATION_LIFECYCLE_ARTIFACT_DIR}/${phase}.json"
  local api_probe_url="${INTEGRATION_API_BASE}/api/v1/workspaces"
  local web_probe_url="${PLAYWRIGHT_BASE_URL}/${INTEGRATION_LOCALE}/login"
  local api_probe_status web_probe_status next_web_pid lane_owner_file lane_name owner_pid owner_label started_at
  local api_alive="false"
  local web_alive="false"
  local next_alive="false"

  mkdir -p "${INTEGRATION_LIFECYCLE_ARTIFACT_DIR}"
  api_probe_status="$(curl_status "${api_probe_url}")"
  web_probe_status="$(curl_status "${web_probe_url}")"
  next_web_pid="$(cat "${NEXT_WEB_PID_FILE}" 2>/dev/null || true)"
  lane_owner_file="$(next_generated_root_lane_owner_file "${INTEGRATION_RUN_ROOT}")"
  lane_name="$(lane_owner_field_value "${lane_owner_file}" lane_name)"
  owner_pid="$(lane_owner_field_value "${lane_owner_file}" owner_pid)"
  owner_label="$(lane_owner_field_value "${lane_owner_file}" owner_label)"
  started_at="$(lane_owner_field_value "${lane_owner_file}" started_at)"

  if pid_is_alive "${API_PID}"; then
    api_alive="true"
  fi
  if pid_is_alive "${WEB_PID}"; then
    web_alive="true"
  fi
  if pid_is_alive "${next_web_pid}"; then
    next_alive="true"
  fi

  node - <<'NODE' \
    "${output_file}" \
    "${phase}" \
    "${INTEGRATION_RUN_ID}" \
    "${API_PID:-}" \
    "${api_alive}" \
    "${api_probe_url}" \
    "${api_probe_status}" \
    "${WEB_PID:-}" \
    "${web_alive}" \
    "${next_web_pid}" \
    "${next_alive}" \
    "${web_probe_url}" \
    "${web_probe_status}" \
    "${NEXT_WEB_PROCESS_STATE_FILE}" \
    "${NEXT_DEV_EXIT_MARKER_FILE}" \
    "${lane_owner_file}" \
    "${lane_name}" \
    "${owner_pid}" \
    "${owner_label}" \
    "${started_at}"
const fs = require('node:fs');
const path = require('node:path');

const [
  outputFile,
  phase,
  runId,
  apiPid,
  apiAlive,
  apiProbeUrl,
  apiProbeStatus,
  webPid,
  webAlive,
  nextWebPid,
  nextAlive,
  webProbeUrl,
  webProbeStatus,
  processStateFile,
  exitMarkerFile,
  laneOwnerFile,
  laneName,
  ownerPid,
  ownerLabel,
  startedAt,
] = process.argv.slice(2);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const laneOwnerPresent = fs.existsSync(laneOwnerFile);
const processStatePresent = fs.existsSync(processStateFile);
const exitMarkerPresent = fs.existsSync(exitMarkerFile);

const payload = {
  schema_version: 1,
  captured_at: new Date().toISOString(),
  captured_by: 'run-integration-e2e-full',
  phase,
  run_id: runId,
  api: {
    pid: apiPid || null,
    alive: apiAlive === 'true',
    probe: {
      url: apiProbeUrl,
      status: apiProbeStatus || '000',
    },
  },
  web: {
    wrapper_pid: webPid || null,
    wrapper_alive: webAlive === 'true',
    next_pid: nextWebPid || null,
    next_alive: nextAlive === 'true',
    probe: {
      url: webProbeUrl,
      status: webProbeStatus || '000',
    },
    process_state_file: processStateFile,
    process_state_present: processStatePresent,
    next_dev_exit_marker_file: exitMarkerFile,
    next_dev_exit_marker_present: exitMarkerPresent,
    next_dev_exit_marker: exitMarkerPresent ? readJson(exitMarkerFile) : null,
  },
  lane_owner: {
    file: laneOwnerFile,
    present: laneOwnerPresent,
    lane_name: laneName || null,
    owner_pid: ownerPid || null,
    owner_label: ownerLabel || null,
    started_at: startedAt || null,
  },
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

warm_route() {
  local path="$1"
  local attempts="${2:-20}"
  local url="${PLAYWRIGHT_BASE_URL}${path}"
  local last_code=""
  for _ in $(seq 1 "${attempts}"); do
    last_code="$(curl_status "${url}")"
    if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
      # Hit the route a second time after a short pause so Next dev can finish
      # compiling and the page is less likely to open as a blank first render.
      sleep 1
      last_code="$(curl_status "${url}")"
      if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "[integration-e2e-full] failed to warm route ${path} (last status: ${last_code})" >&2
  return 1
}

try_warm_route() {
  local path="$1"
  if ! warm_route "${path}"; then
    echo "[integration-e2e-full] continuing after non-fatal warm-up miss for ${path}" >&2
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" | grep -q ":${port}"
    return $?
  fi
  return 1
}


ensure_universal_proxy() {
  local proxy_port="${INTEGRATION_UNIVERSAL_PROXY_PORT:-39080}"
  UNIVERSAL_PROXY_RUNTIME_ROOT_DIR="${ROOT_DIR}" \
    UNIVERSAL_PROXY_RUNTIME_STATE_DIR="${INTEGRATION_LOG_DIR}/universal-proxy" \
    UNIVERSAL_PROXY_RUNTIME_PORT="${proxy_port}" \
    UNIVERSAL_PROXY_RUNTIME_DEFAULT_URLS="${INTEGRATION_UNIVERSAL_PROXY_DEFAULT_URLS:-http://127.0.0.1:${proxy_port} http://127.0.0.1:38080}" \
    UNIVERSAL_PROXY_RUNTIME_CONTAINER_NAME="${INTEGRATION_UNIVERSAL_PROXY_CONTAINER_NAME:-agentsmith-integration-universal-proxy-${INTEGRATION_RUN_ID}}" \
    UNIVERSAL_PROXY_RUNTIME_LABEL="integration-e2e-full" \
    UNIVERSAL_PROXY_RUNTIME_LOG_PREFIX="[integration-e2e-full]" \
    universal_proxy_runtime_ensure
}

cleanup_universal_proxy() {
  UNIVERSAL_PROXY_RUNTIME_ROOT_DIR="${ROOT_DIR}" \
    UNIVERSAL_PROXY_RUNTIME_STATE_DIR="${INTEGRATION_LOG_DIR}/universal-proxy" \
    UNIVERSAL_PROXY_RUNTIME_LOG_PREFIX="[integration-e2e-full]" \
    universal_proxy_runtime_cleanup_managed_container
}

if [[ "${BOOTSTRAP_DEPS}" == "true" ]]; then
  run_clean_with_integration_env npm run integration:deps:up
  run_clean_with_integration_env make deps-ready
  gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "integration_deps" "passed" "integration dependencies bootstrapped"
  record_service integration_deps ready "docker compose dependencies bootstrapped"
fi

if [[ "${INIT_DEPS}" == "true" ]]; then
  run_clean_with_integration_env npm run integration:deps:init:postgres
  run_clean_with_integration_env npm run integration:deps:init:keycloak
  gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "integration_identity_seed" "passed" "postgres and keycloak initialized"
  record_service keycloak_seed ready "postgres and keycloak initialized"
fi

if [[ "${INTEGRATION_ENSURE_DEFAULT_WORKSPACE:-true}" == "true" ]]; then
  run_clean_with_integration_env npx tsx scripts/ensure-default-workspace.ts >/dev/null
  gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "default_workspace" "passed" "default workspace ensured"
fi

if ! ensure_universal_proxy; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "proxy" "universal proxy unavailable"
  exit 1
fi
gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "universal_proxy" "passed" "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}"
record_service universal_proxy ready "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}"

if port_in_use "${API_PORT}"; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "api_port" "api port already in use"
  echo "[integration-e2e-full] API port ${API_PORT} is already in use. Stop the process or set INTEGRATION_API_PORT." >&2
  cleanup_universal_proxy
  exit 1
fi

if port_in_use "${WEB_PORT}"; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "web_port" "web port already in use"
  echo "[integration-e2e-full] Web port ${WEB_PORT} is already in use. Stop the process or set INTEGRATION_WEB_PORT." >&2
  cleanup_universal_proxy
  exit 1
fi

rm -rf "${ROOT_DIR}/${NEXT_DIST_DIR}"

API_PID="$(
  start_background_job "${API_LOG}" run_clean env \
    PORT="${API_PORT}" \
    DEBUG_NOTEBOOK_EXECUTION="${DEBUG_NOTEBOOK_EXECUTION:-}" \
    PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-${INTEGRATION_API_BASE}/api/v1}" \
    MBOS_UNIVERSAL_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
    PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
    INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
    KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}" \
    MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}" \
    MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
    REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}" \
    MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
    MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}" \
    MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
    MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
    SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}" \
    SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}" \
    INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
    INTERNAL_AGENT_JUICEFS_CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-}" \
    INTERNAL_AGENT_WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-}" \
    EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-127.0.0.1}" \
    EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-${POSTGRES_PORT}}" \
    EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:${MINIO_API_PORT}}" \
    INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-}" \
    INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-}" \
    JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-}" \
    npm run api:node:dev
)"

WEB_PID="$(
  start_background_job "${WEB_LOG}" run_clean env \
    MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}" \
    MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
    NEXT_DIST_DIR="${NEXT_DIST_DIR}" \
    NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${INTEGRATION_RUN_ROOT}" \
    NEXT_GENERATED_ROOT_MANAGED=1 \
    NEXT_DEV_PID_FILE="${NEXT_WEB_PID_FILE}" \
    NEXT_DEV_PROCESS_STATE_FILE="${NEXT_WEB_PROCESS_STATE_FILE}" \
    NEXT_DEV_PROCESS_KIND=web \
    NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full \
    NEXT_DEV_EXIT_MARKER_FILE="${NEXT_DEV_EXIT_MARKER_FILE}" \
    NEXT_PUBLIC_USE_MSW=false \
    AGENTSMITH_ENABLE_TEST_ROUTES=true \
    NEXT_PUBLIC_API_BASE="${INTEGRATION_API_BASE}/api/v1" \
    NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_URL}" \
    NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
    bash scripts/run-next-dev-safe.sh --port "${WEB_PORT}"
)"

cleanup() {
  capture_integration_lifecycle_observation "pre-stop"
  if [[ "${KEEP_FAILED_ENV}" == "1" && "${PLAYWRIGHT_STATUS}" -ne 0 ]]; then
    lane_mark_status "${INTEGRATION_RUN_ROOT}" failed
    echo "[integration-e2e-full] keeping failed integration environment for inspection" >&2
    echo "[integration-e2e-full] api_log=${API_LOG}" >&2
    echo "[integration-e2e-full] web_log=${WEB_LOG}" >&2
    echo "[integration-e2e-full] playwright_base_url=${PLAYWRIGHT_BASE_URL}" >&2
    echo "[integration-e2e-full] api_base=${INTEGRATION_API_BASE}" >&2
    echo "[integration-e2e-full] test_results=${ROOT_DIR}/test-results" >&2
    lane_prune_runs backend-real "${BACKEND_REAL_KEEP_RUNS}"
    return 0
  fi
  stop_background_job "${PLAYWRIGHT_PID}"
  cleanup_universal_proxy
  stop_background_job "${PROXY_PID}"
  stop_background_job "$(cat "${NEXT_WEB_PID_FILE}" 2>/dev/null || true)"
  stop_background_job "${WEB_PID}"
  stop_background_job "${API_PID}"
  wait "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
  wait "${PROXY_PID}" >/dev/null 2>&1 || true
  wait "${WEB_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
  capture_integration_lifecycle_observation "post-stop"
  next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}"
  next_generated_root_normalize
  next_generated_root_finalize_lane_cleanup
  rm -f "${NEXT_WEB_PID_FILE}"
  if [[ "${PLAYWRIGHT_STATUS}" -eq 0 ]]; then
    lane_mark_status "${INTEGRATION_RUN_ROOT}" success
    rm -rf "${INTEGRATION_RUN_ROOT}"
    if [[ -L "$(backend_real_state_root)/integration" ]] && [[ "$(realpath -m "$(backend_real_state_root)/integration")" == "$(realpath -m "${INTEGRATION_LOG_DIR}")" ]]; then
      rm -f "$(backend_real_state_root)/integration"
    fi
  else
    lane_mark_status "${INTEGRATION_RUN_ROOT}" failed
  fi
  lane_remove_current_link_if_matches backend-real "${INTEGRATION_RUN_ROOT}" current-run
  lane_prune_runs backend-real "${BACKEND_REAL_KEEP_RUNS}"
}
trap cleanup EXIT

api_ready=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${INTEGRATION_API_BASE}/api/v1/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    api_ready=1
    break
  fi
  sleep 1
done

if [[ "${api_ready}" -ne 1 ]]; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "api_ready" "API did not become ready in time (last status: ${code})"
  echo "[integration-e2e-full] API did not become ready in time (last status: ${code})" >&2
  echo "--- API log tail ---" >&2
  tail -n 120 "${API_LOG}" >&2 || true
  exit 1
fi
gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "api_ready" "passed" "${INTEGRATION_API_BASE}"
record_service api ready "${INTEGRATION_API_BASE}"

web_ready=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${PLAYWRIGHT_BASE_URL}/en-US/login" || true)"
  if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    web_ready=1
    break
  fi
  sleep 1
done

if [[ "${web_ready}" -ne 1 ]]; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "web_ready" "Web did not become ready in time (last status: ${code})"
  echo "[integration-e2e-full] Web did not become ready in time (last status: ${code})" >&2
  echo "--- Web log tail ---" >&2
  tail -n 120 "${WEB_LOG}" >&2 || true
  exit 1
fi
gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "web_ready" "passed" "${PLAYWRIGHT_BASE_URL}"
record_service web ready "${PLAYWRIGHT_BASE_URL}"

ACCESS_TOKEN="$(gate_run_auth_preflight "${INTEGRATION_LOG_DIR}" "${KEYCLOAK_BASE_URL}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}" "${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}" "${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}" "${INTEGRATION_API_BASE}/api/v1/me/profile" "failed to obtain integration token" "integration token missing access_token" "authenticated /api/v1/me/profile unavailable")" || exit 1
record_service auth ready "integration dev-admin token bootstrap"

echo "[integration-e2e-full] warming key routes before Playwright..." >&2
try_warm_route "/${INTEGRATION_LOCALE}/login"
try_warm_route "/${INTEGRATION_LOCALE}/login/workspace"
try_warm_route "/${INTEGRATION_LOCALE}/system/login"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/login"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/projects"
gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "browser_auth_preflight" "passed" "workspace routes warmed"

run_clean env \
  BASE_URL="${PLAYWRIGHT_BASE_URL}" \
  INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
  SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}" \
  SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}" \
  INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_REAL_STATE_FILE:-}" \
  INTERNAL_AGENT_JUICEFS_CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-}" \
  INTERNAL_AGENT_WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-}" \
  INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME="${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" \
  INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS="${INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS:-}" \
  INTERNAL_AGENT_JUICEFS_SUBDIR="${INTERNAL_AGENT_JUICEFS_SUBDIR:-}" \
  INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT="${INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT:-}" \
  INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-}" \
  INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-}" \
  INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-}" \
  JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-}" \
  INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE:-}" \
  INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE:-}" \
  INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-}" \
  INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" \
  INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE="${INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE:-}" \
  INTEGRATION_CODEX_RUNNER_BASE_DOCKER_IMAGE="${INTEGRATION_CODEX_RUNNER_BASE_DOCKER_IMAGE:-}" \
  INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE="${INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE:-}" \
  INTEGRATION_CODEX_RUNNER_REBUILD_BASE_IMAGE="${INTEGRATION_CODEX_RUNNER_REBUILD_BASE_IMAGE:-}" \
  INTEGRATION_CODEX_RUNNER_REBUILD_IMAGE="${INTEGRATION_CODEX_RUNNER_REBUILD_IMAGE:-}" \
  INTEGRATION_CODEX_RUNNER_EMBEDDED="${INTEGRATION_CODEX_RUNNER_EMBEDDED:-}" \
  INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS="${INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS:-mbos-context,feishu-docs,jira-ops}" \
  INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_REQUIRED="${INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_REQUIRED:-1}" \
  INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR="${INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR:-}" \
  INTEGRATION_CODEX_RUNNER_MOUNT_READY_TIMEOUT_MS="${INTEGRATION_CODEX_RUNNER_MOUNT_READY_TIMEOUT_MS:-120000}" \
  INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE="${INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE:-}" \
  INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE="${INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE:-}" \
  INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE="${INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE:-}" \
  INTEGRATION_RUNNER_LOG_DIR="${INTEGRATION_RUNNER_LOG_DIR:-}" \
  AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-}" \
  npx playwright test --config playwright.config.integration.ts "${SPEC_FILE}" --project=chromium --workers=1 "$@" &
PLAYWRIGHT_PID=$!
set +e
wait "${PLAYWRIGHT_PID}"
PLAYWRIGHT_STATUS=$?
set -e
if [[ "${PLAYWRIGHT_STATUS}" -ne 0 ]]; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "scenario_assertion_failed" "playwright" "playwright exited with status ${PLAYWRIGHT_STATUS}"
  exit "${PLAYWRIGHT_STATUS}"
fi
gate_record_success "${INTEGRATION_LOG_DIR}" "playwright"
