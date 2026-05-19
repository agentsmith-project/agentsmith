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
source "${ROOT_DIR}/scripts/lib/afscp-local-runtime.sh"

BACKEND_REAL_SESSION_NAME=""
if [[ "${1:-}" == "--session" ]]; then
  BACKEND_REAL_SESSION_NAME="${2:-}"
  if [[ -z "${BACKEND_REAL_SESSION_NAME}" ]]; then
    echo "[integration-e2e-full] --session requires a session name" >&2
    exit 1
  fi
  shift 2
fi

if [[ -n "${BACKEND_REAL_SESSION_NAME}" ]]; then
  case "${BACKEND_REAL_SESSION_NAME}" in
    agent-task-backend-real-runner|chat-backend-real-endpoint) ;;
    *)
      echo "[integration-e2e-full] unsupported backend-real session: ${BACKEND_REAL_SESSION_NAME}" >&2
      exit 1
      ;;
  esac
  if [[ "$#" -ne 0 ]]; then
    echo "[integration-e2e-full] backend-real session ${BACKEND_REAL_SESSION_NAME} does not accept extra arguments" >&2
    exit 1
  fi
  SPEC_FILE="${BACKEND_REAL_SESSION_NAME}"
  PLAYWRIGHT_EXTRA_ARGS=()
else
  SPEC_FILE="${1:-e2e/integration-chat.spec.ts}"
  shift || true
  PLAYWRIGHT_EXTRA_ARGS=("$@")
fi

ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
ORIGINAL_INTEGRATION_BASE_URL="${INTEGRATION_BASE_URL:-}"
ORIGINAL_INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-}"
ORIGINAL_BACKEND_REAL_STATE_DIR="${BACKEND_REAL_STATE_DIR:-}"
ORIGINAL_INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-}"
ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"
ORIGINAL_INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT:-}"
ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"

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
if [[ -n "${ORIGINAL_INTEGRATION_POSTGRES_PORT}" ]]; then
  export INTEGRATION_POSTGRES_PORT="${ORIGINAL_INTEGRATION_POSTGRES_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MONGO_PORT}" ]]; then
  export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_REDIS_PORT}" ]]; then
  export INTEGRATION_REDIS_PORT="${ORIGINAL_INTEGRATION_REDIS_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MINIO_API_PORT}" ]]; then
  export INTEGRATION_MINIO_API_PORT="${ORIGINAL_INTEGRATION_MINIO_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT}" ]]; then
  export INTEGRATION_MINIO_CONSOLE_PORT="${ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}" ]]; then
  export INTEGRATION_KEYCLOAK_PORT="${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}"
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
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@127.0.0.1:${MONGO_PORT}/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
export MONGO_URL MONGO_DB_NAME
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"
ensure_backend_real_state
INTEGRATION_RUN_ID="${INTEGRATION_RUN_ID:-$(lane_generate_run_id integration)}"
INTEGRATION_RUN_ROOT="${INTEGRATION_RUN_ROOT:-$(lane_prepare_run_root backend-real "${INTEGRATION_RUN_ID}" current-run)}"
UX_TRACE_OUTPUT_ROOT="${UX_TRACE_OUTPUT_ROOT:-${INTEGRATION_RUN_ROOT}/ux-traces}"
INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-${INTEGRATION_RUN_ROOT}/integration}"
REAL_SESSION_ROOT="${INTEGRATION_LOG_DIR}/real-session"
INTEGRATION_AFSCP_LOCAL_RUNTIME="${INTEGRATION_AFSCP_LOCAL_RUNTIME:-true}"
INTEGRATION_AFSCP_DIR="${INTEGRATION_AFSCP_DIR:-${INTEGRATION_RUN_ROOT}/afscp}"
export CURRENT_GATE_RESULT_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-lane-backend-real-core}"
export CURRENT_GATE_RESULT_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-lane:backend-real:core}"
export CURRENT_GATE_RESULT_CI_JOB="${CURRENT_GATE_RESULT_CI_JOB:-lane-backend-real-core}"
export CURRENT_GATE_RESULT_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-backend_real}"
export RUNTIME_LINE_ID="${RUNTIME_LINE_ID:-$(basename "${INTEGRATION_RUN_ROOT}")}"
export UX_TRACE_OUTPUT_ROOT
PARENT_STACK_REUSE_MODE="${INTEGRATION_PARENT_STACK_REUSE:-false}"
case "${PARENT_STACK_REUSE_MODE}" in
  true|1)
    PARENT_STACK_REUSE_MODE="true"
    ;;
  false|0|"")
    PARENT_STACK_REUSE_MODE="false"
    ;;
  *)
    echo "[integration-e2e-full] INTEGRATION_PARENT_STACK_REUSE must be true or false" >&2
    exit 1
    ;;
esac
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
resolve_afscp_local_runtime_defaults "${API_PORT}" "vol_integration"

BOOTSTRAP_DEPS="${INTEGRATION_BOOTSTRAP_DEPS:-true}"
INIT_DEPS="${INTEGRATION_INIT_DEPS:-true}"

mkdir -p "${INTEGRATION_LOG_DIR}" "${INTEGRATION_AFSCP_DIR}"
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
if [[ "${PARENT_STACK_REUSE_MODE}" != "true" ]]; then
  next_generated_root_write_lane_owner "${INTEGRATION_RUN_ROOT}" "backend-real" "$$" "run-integration-e2e-full.sh"
fi
API_PID=""
WEB_PID=""
PROXY_PID=""
PLAYWRIGHT_PID=""
PLAYWRIGHT_STATUS=1
KEEP_FAILED_ENV="${INTEGRATION_KEEP_FAILED_ENV:-0}"
BACKEND_REAL_KEEP_RUNS="${BACKEND_REAL_KEEP_RUNS:-5}"
INTEGRATION_AFSCP_LOCAL_RUNTIME_OWNED=0

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${INTEGRATION_LOG_DIR}" "${service_name}" "${status}" "${detail}"
}

parent_stack_reuse_enabled() {
  [[ "${PARENT_STACK_REUSE_MODE}" == "true" ]]
}

parent_stack_fail_closed() {
  local message="$1"
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "parent_stack_reuse" "${message}"
  echo "[integration-e2e-full] parent-owned existing stack reuse refused: ${message}" >&2
  exit 1
}

require_parent_stack_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    parent_stack_fail_closed "missing ${name}"
  fi
}

require_parent_stack_truth_flag() {
  local name="$1"
  require_parent_stack_value "${name}"
  case "${!name}" in
    true|1) ;;
    *) parent_stack_fail_closed "${name} must be true" ;;
  esac
}

parent_stack_normalize_loopback_host() {
  local host="$1"
  host="${host#[}"
  host="${host%]}"
  local lower_host="${host,,}"

  case "${lower_host}" in
    localhost|127.0.0.1|::1|0:0:0:0:0:0:0:1)
      printf '__loopback__'
      ;;
    *)
      printf '%s' "${lower_host}"
      ;;
  esac
}

parent_stack_normalize_loopback_url() {
  local raw="$1"
  local prefix authority suffix userinfo hostport host remainder normalized_host

  if [[ ! "${raw}" =~ ^([^:/?#]+://)([^/?#]*)(.*)$ ]]; then
    printf '%s' "${raw}"
    return 0
  fi

  prefix="${BASH_REMATCH[1]}"
  authority="${BASH_REMATCH[2]}"
  suffix="${BASH_REMATCH[3]}"
  userinfo=""
  hostport="${authority}"

  if [[ "${hostport}" == *@* ]]; then
    userinfo="${hostport%@*}@"
    hostport="${hostport##*@}"
  fi

  if [[ "${hostport}" == \[*\]* ]]; then
    host="${hostport%%]*}"
    host="${host#\[}"
    remainder="${hostport#*\]}"
  elif [[ "${hostport}" == *:* ]]; then
    host="${hostport%%:*}"
    remainder="${hostport#"${host}"}"
  else
    host="${hostport}"
    remainder=""
  fi

  normalized_host="$(parent_stack_normalize_loopback_host "${host}")"
  printf '%s%s%s%s%s' "${prefix}" "${userinfo}" "${normalized_host}" "${remainder}" "${suffix}"
}

parent_stack_normalize_comparable_value() {
  local name="$1"
  local value="$2"

  case "${name}" in
    INTEGRATION_PARENT_STACK_API_BASE|INTEGRATION_PARENT_STACK_WEB_BASE_URL|INTEGRATION_PARENT_STACK_HOST_WEB_BASE_URL|INTEGRATION_PARENT_STACK_KEYCLOAK_BASE_URL|INTEGRATION_PARENT_STACK_MONGO_URL|INTEGRATION_PARENT_STACK_DATABASE_URL|INTEGRATION_PARENT_STACK_REDIS_URL)
      parent_stack_normalize_loopback_url "${value}"
      ;;
    INTEGRATION_PARENT_STACK_MINIO_ENDPOINT)
      parent_stack_normalize_loopback_host "${value}"
      ;;
    *)
      printf '%s' "${value}"
      ;;
  esac
}

require_parent_stack_equal() {
  local name="$1"
  local actual="$2"
  local expected normalized_expected normalized_actual
  require_parent_stack_value "${name}"
  expected="${!name}"
  if [[ "${expected}" != "${actual}" ]]; then
    normalized_expected="$(parent_stack_normalize_comparable_value "${name}" "${expected}")"
    normalized_actual="$(parent_stack_normalize_comparable_value "${name}" "${actual}")"
    if [[ "${normalized_expected}" != "${normalized_actual}" ]]; then
      parent_stack_fail_closed "${name}=${expected} does not match resolved value ${actual}"
    fi
  fi
}

process_env_value() {
  local pid="$1"
  local name="$2"
  [[ -r "/proc/${pid}/environ" ]] || return 1
  tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n "s/^${name}=//p" | head -n 1
}

require_parent_owned_process_truth() {
  local pid_var="$1"
  local service_kind="$2"
  local root_pid_var="$3"
  local pid="${!pid_var:-}"
  local root_pid="${!root_pid_var:-}"
  local owner_token service_env root_env

  require_parent_stack_value "${pid_var}"
  require_parent_stack_value "${root_pid_var}"
  require_parent_stack_value "INTEGRATION_PARENT_STACK_OWNER_TOKEN"

  if ! pid_is_alive "${pid}"; then
    parent_stack_fail_closed "${pid_var}=${pid} is not alive"
  fi

  owner_token="$(process_env_value "${pid}" "LOCAL_RUNTIME_OWNER_TOKEN" || true)"
  service_env="$(process_env_value "${pid}" "LOCAL_RUNTIME_SERVICE_KIND" || true)"
  root_env="$(process_env_value "${pid}" "LOCAL_RUNTIME_TREE_ROOT_PID" || true)"

  if [[ "${owner_token}" != "${INTEGRATION_PARENT_STACK_OWNER_TOKEN}" ]]; then
    parent_stack_fail_closed "${pid_var} owner token mismatch"
  fi
  if [[ "${service_env}" != "${service_kind}" ]]; then
    parent_stack_fail_closed "${pid_var} service kind mismatch"
  fi
  if [[ "${root_env}" != "${root_pid}" ]]; then
    parent_stack_fail_closed "${pid_var} tree root mismatch"
  fi
}

require_parent_owned_existing_stack_reuse_truth() {
  if [[ -n "${BACKEND_REAL_SESSION_NAME}" ]]; then
    parent_stack_fail_closed "backend-real sessions cannot use parent stack reuse"
  fi
  if managed_agent_task_asbcp_required; then
    parent_stack_fail_closed "managed Agent Task specs cannot use parent stack reuse"
  fi

  require_parent_stack_truth_flag "INTEGRATION_PARENT_STACK_DEPS_READY"
  require_parent_stack_truth_flag "INTEGRATION_PARENT_STACK_DEPS_INIT_READY"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_API_PORT" "${API_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_WEB_PORT" "${WEB_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_POSTGRES_PORT" "${POSTGRES_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MONGO_PORT" "${MONGO_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_REDIS_PORT" "${REDIS_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MINIO_API_PORT" "${MINIO_API_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MINIO_CONSOLE_PORT" "${MINIO_CONSOLE_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_KEYCLOAK_PORT" "${KEYCLOAK_PORT}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_API_BASE" "${INTEGRATION_API_BASE}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_WEB_BASE_URL" "${PLAYWRIGHT_BASE_URL}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_HOST_WEB_BASE_URL" "${RUNTIME_HOST_WEB_BASE_URL}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_KEYCLOAK_BASE_URL" "${KEYCLOAK_BASE_URL}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_KEYCLOAK_REALM" "${KEYCLOAK_REALM}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_KEYCLOAK_CLIENT_ID" "${KEYCLOAK_CLIENT_ID}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MONGO_URL" "${MONGO_URL}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MONGO_DB_NAME" "${MONGO_DB_NAME}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_DATABASE_URL" "${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_REDIS_URL" "${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MINIO_ENDPOINT" "${MINIO_ENDPOINT:-localhost}"
  require_parent_stack_equal "INTEGRATION_PARENT_STACK_MINIO_PORT" "${MINIO_PORT:-${MINIO_API_PORT}}"
  require_parent_stack_value "INTEGRATION_PARENT_STACK_RUN_ROOT"
  require_parent_stack_value "INTEGRATION_PARENT_STACK_PROCESS_STATE_DIR"
  require_parent_owned_process_truth "INTEGRATION_PARENT_STACK_API_ROOT_PID" "api" "INTEGRATION_PARENT_STACK_API_ROOT_PID"
  require_parent_owned_process_truth "INTEGRATION_PARENT_STACK_API_PID" "api" "INTEGRATION_PARENT_STACK_API_ROOT_PID"
  require_parent_owned_process_truth "INTEGRATION_PARENT_STACK_WEB_ROOT_PID" "web" "INTEGRATION_PARENT_STACK_WEB_ROOT_PID"

  gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "parent_stack_reuse" "passed" "parent-owned release stack truth verified"
  record_service parent_stack_reuse ready "${PLAYWRIGHT_BASE_URL} -> ${INTEGRATION_API_BASE}"
}

managed_agent_task_asbcp_required() {
  case "${BACKEND_REAL_SESSION_NAME:-${SPEC_FILE}}" in
    agent-task-backend-real-runner|e2e/integration-agent-task-runner.spec.ts|e2e/integration-visual-review.spec.ts)
      return 0
      ;;
  esac

  if [[ -z "${BACKEND_REAL_SESSION_NAME:-}" ]]; then
    local spec_path="${SPEC_FILE}"
    if [[ "${spec_path}" != /* ]]; then
      spec_path="${ROOT_DIR}/${spec_path}"
    fi
    if [[ -f "${spec_path}" ]] && grep -q 'startAgentTaskRunViaApi' "${spec_path}"; then
      return 0
    fi
  fi

  return 1
}

preflight_managed_agent_task_asbcp_env() {
  if ! managed_agent_task_asbcp_required; then
    return 0
  fi

  local missing=()
  if [[ -z "${ASBCP_INTERNAL_BASE_URL:-}" ]]; then
    missing+=("ASBCP_INTERNAL_BASE_URL")
  fi
  if [[ -z "${ASBCP_SERVICE_KEY:-}" ]]; then
    missing+=("ASBCP_SERVICE_KEY")
  fi
  if [[ -z "${AGENT_EXECUTION_WS_BASE_URL:-}" ]]; then
    missing+=("AGENT_EXECUTION_WS_BASE_URL")
  fi
  if [[ -z "${INTERNAL_AGENT_K8S_NAMESPACE:-}" ]]; then
    missing+=("INTERNAL_AGENT_K8S_NAMESPACE")
  fi
  if [[ "${#missing[@]}" -eq 0 ]]; then
    gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "managed_agent_task_asbcp_env" "passed" "ASBCP env present"
    return 0
  fi

  local missing_text
  missing_text="$(IFS=,; printf '%s' "${missing[*]}")"
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "managed_agent_task_asbcp_env" "Managed Agent Task backend-real coverage requires ASBCP bootstrap; missing ${missing_text}. Use scripts/run-internal-agent-task-real-gate.sh --visual-review/--skills-runtime or provide the managed ASBCP env."
  echo "[integration-e2e-full] Managed Agent Task backend-real coverage requires ASBCP bootstrap." >&2
  echo "[integration-e2e-full] Missing: ${missing_text}" >&2
  echo "[integration-e2e-full] Use scripts/run-internal-agent-task-real-gate.sh --visual-review/--skills-runtime or provide the managed ASBCP env." >&2
  exit 1
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
    MONGO_URL="${MONGO_URL}" \
    MONGO_DB_NAME="${MONGO_DB_NAME}" \
    REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}" \
    MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
    MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}" \
    MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
    MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
    AFSCP_BASE_URL="${AFSCP_BASE_URL}" \
    AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \
    AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
    AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
    AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
    AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
    AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \
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
    UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED="${INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED:-${UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED:-0}}" \
    UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST="${INTEGRATION_UNIVERSAL_PROXY_UPSTREAM_HOST:-${UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST:-host.docker.internal}}" \
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

ensure_integration_afscp_local_runtime() {
  if [[ "${INTEGRATION_AFSCP_LOCAL_RUNTIME}" != "true" ]]; then
    gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "afscp_local_runtime" "skipped" "INTEGRATION_AFSCP_LOCAL_RUNTIME=${INTEGRATION_AFSCP_LOCAL_RUNTIME}"
    return 0
  fi

  echo "[integration-e2e-full] ensuring AFSCP local runtime at ${AFSCP_BASE_URL}" >&2
  INTEGRATION_AFSCP_LOCAL_RUNTIME_OWNED=1
  stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}" >/dev/null 2>&1 || true
  reset_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
  ensure_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
}

stop_integration_afscp_local_runtime() {
  if [[ "${INTEGRATION_AFSCP_LOCAL_RUNTIME_OWNED}" != "1" ]]; then
    return 0
  fi

  stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
}

if parent_stack_reuse_enabled; then
  require_parent_owned_existing_stack_reuse_truth
else
  preflight_managed_agent_task_asbcp_env

  if [[ "${BOOTSTRAP_DEPS}" == "true" ]]; then
    run_clean_with_integration_env make deps-bootstrap
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

  if ! ensure_integration_afscp_local_runtime; then
    gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "afscp_local_runtime" "AFSCP local runtime unavailable"
    echo "[integration-e2e-full] AFSCP local runtime did not become ready at ${AFSCP_BASE_URL}" >&2
    stop_integration_afscp_local_runtime || true
    cleanup_universal_proxy
    exit 1
  fi
  gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "afscp_local_runtime" "passed" "${AFSCP_BASE_URL}"
  record_service afscp_local_runtime ready "${AFSCP_BASE_URL}"

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
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}" \
      MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
      MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}" \
      MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
      MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
      MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
      MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
      ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL:-}" \
      ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY:-}" \
      AFSCP_BASE_URL="${AFSCP_BASE_URL}" \
      AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \
      AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
      AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
      AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
      AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
      AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
      AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \
      INTERNAL_AGENT_IMAGE="${INTERNAL_AGENT_IMAGE:-${INTEGRATION_INTERNAL_AGENT_IMAGE:-}}" \
      INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" \
      INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
      AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-}" \
      npm run api:node:dev
  )"

  WEB_PID="$(
    start_background_job "${WEB_LOG}" run_clean env \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      NEXT_DIST_DIR="${NEXT_DIST_DIR}" \
      NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${INTEGRATION_RUN_ROOT}" \
      NEXT_GENERATED_ROOT_MANAGED=1 \
      NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE:-validation}" \
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
      AFSCP_BASE_URL="${AFSCP_BASE_URL}" \
      AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \
      AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
      AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
      AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
      AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
      AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
      AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \
      bash scripts/run-next-dev-safe.sh --port "${WEB_PORT}"
  )"
fi

cleanup() {
  set +e
  if parent_stack_reuse_enabled; then
    stop_background_job "${PLAYWRIGHT_PID}"
    wait "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
    if [[ "${PLAYWRIGHT_STATUS}" -eq 0 ]]; then
      lane_mark_status "${INTEGRATION_RUN_ROOT}" success
    else
      lane_mark_status "${INTEGRATION_RUN_ROOT}" failed
    fi
    lane_remove_current_link_if_matches backend-real "${INTEGRATION_RUN_ROOT}" current-run
    lane_prune_runs backend-real "${BACKEND_REAL_KEEP_RUNS}"
    return 0
  fi
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
  if stop_integration_afscp_local_runtime; then
    record_service afscp_local_runtime stopped "${AFSCP_BASE_URL}"
  else
    record_service afscp_local_runtime cleanup_failed "${AFSCP_BASE_URL}"
    echo "[integration-e2e-full] cleanup warning: AFSCP local runtime stop failed" >&2
  fi
  capture_integration_lifecycle_observation "post-stop"
  next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}" || true
  next_generated_root_normalize || echo "[integration-e2e-full] cleanup warning: next generated root normalize failed" >&2
  next_generated_root_finalize_lane_cleanup || echo "[integration-e2e-full] cleanup warning: next generated root finalize failed" >&2
  rm -f "${NEXT_WEB_PID_FILE}"
  if [[ "${PLAYWRIGHT_STATUS}" -eq 0 ]]; then
    lane_mark_status "${INTEGRATION_RUN_ROOT}" success
    if [[ -z "${BACKEND_REAL_SESSION_NAME}" ]]; then
      rm -rf "${INTEGRATION_RUN_ROOT}"
      if [[ -L "$(backend_real_state_root)/integration" ]] && [[ "$(realpath -m "$(backend_real_state_root)/integration")" == "$(realpath -m "${INTEGRATION_LOG_DIR}")" ]]; then
        rm -f "$(backend_real_state_root)/integration"
      fi
    fi
  else
    lane_mark_status "${INTEGRATION_RUN_ROOT}" failed
  fi
  lane_remove_current_link_if_matches backend-real "${INTEGRATION_RUN_ROOT}" current-run
  lane_prune_runs backend-real "${BACKEND_REAL_KEEP_RUNS}"
}
trap cleanup EXIT

API_READY_ATTEMPTS="${INTEGRATION_API_READY_ATTEMPTS:-120}"
WEB_READY_ATTEMPTS="${INTEGRATION_WEB_READY_ATTEMPTS:-120}"
READY_RETRY_SLEEP_SECONDS="${INTEGRATION_READY_RETRY_SLEEP_SECONDS:-1}"

api_ready=0
for _ in $(seq 1 "${API_READY_ATTEMPTS}"); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${INTEGRATION_API_BASE}/api/v1/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    api_ready=1
    break
  fi
  sleep "${READY_RETRY_SLEEP_SECONDS}"
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
for _ in $(seq 1 "${WEB_READY_ATTEMPTS}"); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${PLAYWRIGHT_BASE_URL}/en-US/login" || true)"
  if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    web_ready=1
    break
  fi
  sleep "${READY_RETRY_SLEEP_SECONDS}"
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

test_routes_status="$(curl -s -o /dev/null -w "%{http_code}" "${PLAYWRIGHT_BASE_URL}/api/test/system/workspaces/seed" || true)"
if [[ "${test_routes_status}" != "200" ]]; then
  gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "web_test_routes" "Web test routes unavailable at ${PLAYWRIGHT_BASE_URL} (status: ${test_routes_status})"
  echo "[integration-e2e-full] Web test routes are unavailable at ${PLAYWRIGHT_BASE_URL} (status: ${test_routes_status})." >&2
  echo "[integration-e2e-full] Ensure the isolated web server started with AGENTSMITH_ENABLE_TEST_ROUTES=true and BASE_URL targets that server." >&2
  echo "--- Web log tail ---" >&2
  tail -n 120 "${WEB_LOG}" >&2 || true
  exit 1
fi
gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "web_test_routes" "passed" "${PLAYWRIGHT_BASE_URL}/api/test/system/workspaces/seed"

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

run_playwright_command() {
  local spec_file="$1"
  shift
  run_clean env \
    BASE_URL="${PLAYWRIGHT_BASE_URL}" \
    INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
    MONGO_URL="${MONGO_URL}" \
    MONGO_DB_NAME="${MONGO_DB_NAME}" \
    MBOS_UNIVERSAL_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" \
    MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}" \
    MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST="${MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST:-}" \
    ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL:-}" \
    ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY:-}" \
    INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
    INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_REAL_STATE_FILE:-}" \
    AFSCP_STORAGE_CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-}" \
    AFSCP_STORAGE_CAPACITY="${AFSCP_STORAGE_CAPACITY:-}" \
    AFSCP_STORAGE_CLASS_NAME="${AFSCP_STORAGE_CLASS_NAME:-}" \
    AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${AFSCP_STORAGE_CSI_MOUNT_OPTIONS:-}" \
    AFSCP_STORAGE_CSI_SUBDIR="${AFSCP_STORAGE_CSI_SUBDIR:-}" \
    AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT:-}" \
    AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-}" \
    AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE:-}" \
    AFSCP_BASE_URL="${AFSCP_BASE_URL}" \
    AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \
    AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
    AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
    AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
    AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
    AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \
    AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-}" \
    INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" \
    INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-}" \
    INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-0}" \
    INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE:-0}" \
    INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED="${INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS:-mbos-context,feishu-docs,jira-ops}" \
    INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED:-1}" \
    INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR:-}" \
    INTEGRATION_AGENT_TASK_RUNNER_WORKSPACE_READY_TIMEOUT_MS="${INTEGRATION_AGENT_TASK_RUNNER_WORKSPACE_READY_TIMEOUT_MS:-120000}" \
    INTEGRATION_RUNNER_LOG_DIR="${INTEGRATION_RUNNER_LOG_DIR:-}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-}" \
    npx playwright test --config playwright.config.integration.ts "${spec_file}" --project=chromium --workers=1 "$@"
}

redact_log_file() {
  local input_file="$1"
  local output_file="$2"
  node - <<'NODE' "${input_file}" "${output_file}"
const fs = require('node:fs');
const path = require('node:path');
const [inputFile, outputFile] = process.argv.slice(2);
let content = '';
try {
  content = fs.readFileSync(inputFile, 'utf8');
} catch {
  content = '';
}
const sensitiveAssignment = /((?:[A-Za-z0-9_.-]*)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|admin[_-]?token|oauth(?:[_-]?token)?|client[_-]?secret|password|ticket|managed[_-]?credentials?|cookie|authorization)(?:[A-Za-z0-9_.-]*)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\bBearer\s+[^\s"',}]+|[^\s"',}]+)/gi;
const redacted = content
  .replace(sensitiveAssignment, '$1[redacted]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}/gi, 'sk-[redacted]');
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, redacted);
NODE
}

write_shard_result() {
  local shard_dir="$1"
  local shard_id="$2"
  local spec_file="$3"
  local started_at="$4"
  local finished_at="$5"
  local exit_code="$6"
  shift 6
  node - <<'NODE' "${shard_dir}/result.json" "${shard_id}" "${spec_file}" "${started_at}" "${finished_at}" "${exit_code}" "$@"
const fs = require('node:fs');
const path = require('node:path');
const [file, shardId, specFile, startedAt, finishedAt, exitCodeRaw, ...args] = process.argv.slice(2);
const exitCode = Number(exitCodeRaw);
const started = Date.parse(startedAt);
const finished = Date.parse(finishedAt);
const payload = {
  schema_version: 1,
  diagnostic_only: true,
  shard_id: shardId,
  spec_file: specFile,
  grep: (() => {
    const index = args.indexOf('--grep');
    return index >= 0 ? args[index + 1] ?? null : null;
  })(),
  args,
  diagnostic_state: exitCode === 0 ? 'succeeded' : 'failed',
  exit_code: exitCode,
  started_at: startedAt,
  finished_at: finishedAt,
  duration_ms: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null,
  logs: {
    stdout: 'playwright.stdout.log',
    stderr: 'playwright.stderr.log',
  },
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

write_session_aggregate() {
  local session_state="$1"
  shift
  node - <<'NODE' "${REAL_SESSION_ROOT}/aggregate.json" "${BACKEND_REAL_SESSION_NAME}" "${INTEGRATION_RUN_ID}" "${session_state}" "${REAL_SESSION_ROOT}" "$@"
const fs = require('node:fs');
const path = require('node:path');
const [file, sessionName, runId, sessionState, sessionRoot, ...shardIds] = process.argv.slice(2);
const shards = shardIds.map((shardId) => {
  const resultFile = path.join(sessionRoot, 'shards', shardId, 'result.json');
  if (!fs.existsSync(resultFile)) {
    return {
      shard_id: shardId,
      diagnostic_state: 'not_run',
      exit_code: null,
      spec_file: null,
      grep: null,
      result_path: path.relative(sessionRoot, resultFile),
    };
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  return {
    shard_id: result.shard_id,
    diagnostic_state: result.diagnostic_state,
    exit_code: result.exit_code,
    spec_file: result.spec_file,
    grep: result.grep,
    result_path: path.relative(sessionRoot, resultFile),
  };
});
const payload = {
  schema_version: 1,
  diagnostic_only: true,
  session_id: sessionName,
  run_id: runId,
  diagnostic_state: sessionState,
  fixed_cost: {
    startup_count: 1,
    backend_real_stack_reuse: true,
  },
  shards,
  generated_at: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

run_playwright_shard() {
  local shard_id="$1"
  local spec_file="$2"
  shift 2
  local shard_dir="${REAL_SESSION_ROOT}/shards/${shard_id}"
  local stdout_raw="${shard_dir}/playwright.stdout.raw.log"
  local stderr_raw="${shard_dir}/playwright.stderr.raw.log"
  local stdout_log="${shard_dir}/playwright.stdout.log"
  local stderr_log="${shard_dir}/playwright.stderr.log"
  local started_at finished_at shard_status

  mkdir -p "${shard_dir}"
  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "[integration-e2e-full] running backend-real session shard ${shard_id}: ${spec_file}" >&2
  set +e
  run_playwright_command "${spec_file}" "$@" >"${stdout_raw}" 2>"${stderr_raw}" &
  PLAYWRIGHT_PID=$!
  wait "${PLAYWRIGHT_PID}"
  shard_status=$?
  PLAYWRIGHT_PID=""
  set -e
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  redact_log_file "${stdout_raw}" "${stdout_log}"
  redact_log_file "${stderr_raw}" "${stderr_log}"
  rm -f "${stdout_raw}" "${stderr_raw}"
  write_shard_result "${shard_dir}" "${shard_id}" "${spec_file}" "${started_at}" "${finished_at}" "${shard_status}" "$@"
  PLAYWRIGHT_STATUS="${shard_status}"
  return "${shard_status}"
}

run_single_playwright() {
  run_playwright_command "${SPEC_FILE}" "${PLAYWRIGHT_EXTRA_ARGS[@]}" &
  PLAYWRIGHT_PID=$!
  set +e
  wait "${PLAYWRIGHT_PID}"
  PLAYWRIGHT_STATUS=$?
  PLAYWRIGHT_PID=""
  set -e
  return "${PLAYWRIGHT_STATUS}"
}

run_agent_task_backend_real_session_shards() {
  local session_status=0
  local shard_ids=("agent-task-runner")
  mkdir -p "${REAL_SESSION_ROOT}/shards"
  run_playwright_shard "agent-task-runner" "e2e/integration-agent-task-runner.spec.ts" --grep-invert docker || session_status=$?
  if [[ "${session_status}" -eq 0 ]]; then
    write_session_aggregate "succeeded" "${shard_ids[@]}"
  else
    write_session_aggregate "failed" "${shard_ids[@]}"
  fi
  return "${session_status}"
}

run_backend_real_chat_endpoint_session_shards() {
  local session_status=0
  local shard_ids=(
    "chat-endpoint-real-completion"
    "chat-stop-escalation"
  )
  mkdir -p "${REAL_SESSION_ROOT}/shards"
  run_playwright_shard "chat-endpoint-real-completion" "e2e/integration-chat.spec.ts" --grep "real deepseek" || session_status=$?
  if [[ "${session_status}" -eq 0 ]]; then
    run_playwright_shard "chat-stop-escalation" "e2e/integration-chat.spec.ts" --grep "stop escalation resyncs authoritative thread truth after refresh and keeps composer ready" || session_status=$?
  fi
  if [[ "${session_status}" -eq 0 ]]; then
    write_session_aggregate "succeeded" "${shard_ids[@]}"
  else
    write_session_aggregate "failed" "${shard_ids[@]}"
  fi
  return "${session_status}"
}

classify_playwright_failure() {
  local status="$1"
  PLAYWRIGHT_FAILURE_CLASSIFICATION="scenario_assertion_failed"
  PLAYWRIGHT_FAILURE_STAGE="playwright"
  PLAYWRIGHT_FAILURE_MESSAGE="playwright exited with status ${status}"

  local search_paths=()
  if [[ -d "${REAL_SESSION_ROOT}" ]]; then
    search_paths+=("${REAL_SESSION_ROOT}")
  fi
  if [[ -d "${INTEGRATION_LOG_DIR}/playwright" ]]; then
    search_paths+=("${INTEGRATION_LOG_DIR}/playwright")
  fi

  if [[ "${#search_paths[@]}" -gt 0 ]] && grep -R -E -q \
    'docker_(chat_)?runner_image_(build_failed|missing)|docker_runner_(start_failed|connect_timeout)|failed to resolve source metadata|unexpected status from HEAD request' \
    "${search_paths[@]}" 2>/dev/null; then
    PLAYWRIGHT_FAILURE_CLASSIFICATION="runner_launch_failed"
    PLAYWRIGHT_FAILURE_STAGE="runner_image_build"
    PLAYWRIGHT_FAILURE_MESSAGE="docker runner image build/pull failed; see ${INTEGRATION_LOG_DIR}"
  fi
}

if [[ -n "${BACKEND_REAL_SESSION_NAME}" ]]; then
  case "${BACKEND_REAL_SESSION_NAME}" in
    agent-task-backend-real-runner)
      run_agent_task_backend_real_session_shards || PLAYWRIGHT_STATUS=$?
      ;;
    chat-backend-real-endpoint)
      run_backend_real_chat_endpoint_session_shards || PLAYWRIGHT_STATUS=$?
      ;;
  esac
else
  run_single_playwright || PLAYWRIGHT_STATUS=$?
fi

if [[ "${PLAYWRIGHT_STATUS}" -ne 0 ]]; then
  classify_playwright_failure "${PLAYWRIGHT_STATUS}"
  gate_record_failure "${INTEGRATION_LOG_DIR}" "${PLAYWRIGHT_FAILURE_CLASSIFICATION}" "${PLAYWRIGHT_FAILURE_STAGE}" "${PLAYWRIGHT_FAILURE_MESSAGE}"
  exit "${PLAYWRIGHT_STATUS}"
fi
gate_record_success "${INTEGRATION_LOG_DIR}" "playwright"
