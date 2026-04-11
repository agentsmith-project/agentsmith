#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

API_PORT="${API_PORT:-${INTEGRATION_API_PORT:-20000}}"
WEB_PORT="${WEB_PORT:-${INTEGRATION_WEB_PORT:-3001}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
API_BASE="${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
WEB_BASE="${BASE_URL:-${RUNTIME_BROWSER_WEB_BASE_URL}}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
TIMEOUT_SEC="${READY_TIMEOUT_SEC:-180}"
SLEEP_SEC="${READY_SLEEP_SEC:-2}"
CSI_NAMESPACE="${CSI_NAMESPACE:-kube-system}"
CSI_DAEMONSET="${CSI_DAEMONSET:-juicefs-csi-node}"

info() { echo "[wait-real-stack-ready] $*"; }

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE "[\[\]:*]${port}[[:space:]]"; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${port}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

start_background_job() {
  local log_file="$1"
  shift
  mkdir -p "$(dirname "${log_file}")"
  "$@" >"${log_file}" 2>&1 &
  echo $!
}

run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

ensure_local_release_stack() {
  local state_dir api_log web_log api_pid web_pid
  state_dir="$(backend_real_state_root)/release-ready"
  api_log="${state_dir}/api.log"
  web_log="${state_dir}/web.log"
  mkdir -p "${state_dir}"

  if ! is_port_listening "${API_PORT}"; then
    info "starting local API on :${API_PORT} for readiness"
    api_pid="$(
      PORT="${API_PORT}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
      INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
      KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
      KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
      DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:15432/mbos}" \
      MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
      MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
      REDIS_URL="${REDIS_URL:-redis://localhost:16379}" \
      MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
      MINIO_PORT="${MINIO_PORT:-19000}" \
      MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
      MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
      MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
      MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
      start_background_job "${api_log}" run_clean npm run api:node:dev
    )"
    state_set_string services.local_api_pid "${api_pid}"
  fi

  if ! is_port_listening "${WEB_PORT}"; then
    info "starting local Web on :${WEB_PORT} for readiness"
    web_pid="$(
      MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
      MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
      NEXT_PUBLIC_USE_MSW=false \
      AGENTSMITH_ENABLE_TEST_ROUTES=true \
      NEXT_GENERATED_ROOT_MANAGED=1 \
      NEXT_DEV_PID_FILE="${state_dir}/next-dev.pid" \
      NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}/api/v1" \
      NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_BASE_URL}/realms" \
      NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
      NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
      INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
      start_background_job "${web_log}" run_clean bash scripts/run-next-dev-safe.sh --port "${WEB_PORT}"
    )"
    state_set_string services.local_web_pid "${web_pid}"
  fi
}

deadline=$((SECONDS + TIMEOUT_SEC))

wait_http() {
  local name="$1"
  local url="$2"
  until curl -fsS "${url}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "[wait-real-stack-ready] timed out waiting for ${name}: ${url}" >&2
      exit 1
    fi
    sleep "${SLEEP_SEC}"
  done
  info "${name} ready"
}

wait_http_auth() {
  local name="$1"
  local url="$2"
  local token_file="$3"
  if [[ ! -f "${token_file}" ]]; then
    info "${name} auth probe skipped (token file missing: ${token_file})"
    return 0
  fi

  until curl -fsS "${url}" -H "Authorization: Bearer $(cat "${token_file}")" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "[wait-real-stack-ready] timed out waiting for ${name}: ${url}" >&2
      exit 1
    fi
    sleep "${SLEEP_SEC}"
  done
  info "${name} ready"
}

ensure_local_release_stack

wait_http "keycloak oidc discovery" "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM:-mbos}/.well-known/openid-configuration"
wait_http "api docs" "${API_BASE%/}/api/v1/openapi.json"
wait_http "web" "${WEB_BASE%/}/api/public/workspaces"
wait_http_auth "api auth" "${API_BASE%/}/api/v1/me/profile" "${TOKEN_FILE}"

if command -v kubectl >/dev/null 2>&1; then
  if kubectl get daemonset "${CSI_DAEMONSET}" -n "${CSI_NAMESPACE}" >/dev/null 2>&1; then
    kubectl rollout status daemonset/"${CSI_DAEMONSET}" -n "${CSI_NAMESPACE}" --timeout="${TIMEOUT_SEC}s" >/dev/null
    info "csi node daemonset ready"
  fi
fi

info "stack ready"
