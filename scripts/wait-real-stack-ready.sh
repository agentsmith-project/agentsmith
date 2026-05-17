#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/local-runtime-processes.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

API_PORT="${API_PORT:-${INTEGRATION_API_PORT:-20000}}"
WEB_PORT="${WEB_PORT:-${INTEGRATION_WEB_PORT:-3001}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-18080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
EXPLICIT_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-}"
EXPLICIT_PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-}"
EXPLICIT_INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-}"
EXPLICIT_KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
if [[ -n "${EXPLICIT_KEYCLOAK_BASE_URL}" || -n "${EXPLICIT_PUBLIC_KEYCLOAK_BASE_URL}" || -n "${EXPLICIT_INTERNAL_KEYCLOAK_BASE_URL}" || -n "${EXPLICIT_KEYCLOAK_ISSUER_URL}" ]]; then
  KEYCLOAK_BASE_URL="${EXPLICIT_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  PUBLIC_KEYCLOAK_BASE_URL="${EXPLICIT_PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  INTERNAL_KEYCLOAK_BASE_URL="${EXPLICIT_INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  KEYCLOAK_ISSUER_URL="${EXPLICIT_KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
  KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms"
  RUNTIME_BROWSER_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}"
  RUNTIME_HOST_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}"
  export \
    KEYCLOAK_BASE_URL \
    PUBLIC_KEYCLOAK_BASE_URL \
    INTERNAL_KEYCLOAK_BASE_URL \
    KEYCLOAK_ISSUER_URL \
    KEYCLOAK_URL \
    RUNTIME_BROWSER_KEYCLOAK_BASE_URL \
    RUNTIME_HOST_KEYCLOAK_BASE_URL
fi
API_BASE="${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
WEB_BASE="${BASE_URL:-${RUNTIME_BROWSER_WEB_BASE_URL}}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
TIMEOUT_SEC="${READY_TIMEOUT_SEC:-180}"
SLEEP_SEC="${READY_SLEEP_SEC:-2}"
CSI_NAMESPACE="${CSI_NAMESPACE:-kube-system}"
CSI_DAEMONSET="${CSI_DAEMONSET:-juicefs-csi-node}"
BACKEND_REAL_READY_PROBE_ONLY="${BACKEND_REAL_READY_PROBE_ONLY:-0}"

info() { echo "[wait-real-stack-ready] $*"; }

ready_probe_only() {
  [[ "${BACKEND_REAL_READY_PROBE_ONLY}" == "1" ]]
}

ensure_local_release_stack() {
  local state_dir api_log web_log api_pid api_root_pid web_pid web_wrapper_pid next_dev_pid_file next_dev_port_file web_process_state_file
  state_dir="$(backend_real_state_root)/release-ready"
  api_log="${state_dir}/api.log"
  web_log="${state_dir}/web.log"
  next_dev_pid_file="${state_dir}/next-dev.pid"
  next_dev_port_file="${state_dir}/next-dev.port"
  web_process_state_file="${state_dir}/web.process.json"
  mkdir -p "${state_dir}"

  if ! local_runtime_port_is_listening "${API_PORT}"; then
    info "starting local API on :${API_PORT} for readiness"
    api_root_pid="$(
      local_runtime_start_owned_service api "${API_PORT}" "${api_log}" env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
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
        npm run api:node:dev
    )"
    api_pid="$(local_runtime_capture_authoritative_service_pid "${api_root_pid}" api "${API_PORT}" "${TIMEOUT_SEC}")"
    state_set_string services.local_api_pid "${api_pid}"
  fi

  if ! local_runtime_port_is_listening "${WEB_PORT}"; then
    info "starting local Web on :${WEB_PORT} for readiness"
    rm -f "${next_dev_pid_file}" "${next_dev_port_file}" "${web_process_state_file}"
    (
      cd "${ROOT_DIR}"
      env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
        MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
        MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
        NEXT_PUBLIC_USE_MSW=false \
        AGENTSMITH_ENABLE_TEST_ROUTES=true \
        NEXT_GENERATED_ROOT_MANAGED=1 \
        NEXT_DEV_PID_FILE="${next_dev_pid_file}" \
        NEXT_DEV_PORT_FILE="${next_dev_port_file}" \
        NEXT_DEV_PORT="${WEB_PORT}" \
        NEXT_DEV_PROCESS_STATE_FILE="${web_process_state_file}" \
        NEXT_DEV_PROCESS_KIND=web \
        NEXT_DEV_PROCESS_CAPTURED_BY=wait-real-stack-ready \
        NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}/api/v1" \
        NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_BASE_URL}/realms" \
        NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
        NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
        KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
        PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
        INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
        bash scripts/run-next-dev-safe.sh --port "${WEB_PORT}"
    ) >"${web_log}" 2>&1 &
    web_wrapper_pid="$!"
    web_pid=""
    while (( SECONDS < deadline )); do
      web_pid="$(
        node - <<'NODE' "${web_process_state_file}" "${WEB_PORT}"
const fs = require('node:fs');

const [file, expectedPortRaw] = process.argv.slice(2);
const expectedPort = Number.parseInt(expectedPortRaw, 10);
let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(1);
}

const pid = Number.parseInt(String(payload?.pid ?? ''), 10);
const port = Number.parseInt(String(payload?.port ?? ''), 10);
if (
  payload?.schema_version !== 1
  || payload?.kind !== 'web'
  || !Number.isFinite(pid)
  || pid <= 0
  || !Number.isFinite(port)
  || port !== expectedPort
  || typeof payload?.process_identity?.token !== 'string'
  || typeof payload?.process_identity?.source !== 'string'
) {
  process.exit(1);
}

process.stdout.write(String(pid));
NODE
      )" || web_pid=""
      if [[ -n "${web_pid}" ]]; then
        break
      fi
      if ! kill -0 "${web_wrapper_pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.2
    done
    if [[ -z "${web_pid}" ]]; then
      echo "[wait-real-stack-ready] failed to capture authoritative web process state from ${web_process_state_file}" >&2
      tail -n 40 "${web_log}" >&2 || true
      exit 1
    fi
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

if ready_probe_only; then
  info "probe-only readiness: reusing parent stack"
else
  ensure_local_release_stack
fi

wait_http "keycloak oidc discovery" "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM:-mbos}/.well-known/openid-configuration"
wait_http "api docs" "${API_BASE%/}/api/v1/openapi.json"
wait_http "web" "${WEB_BASE%/}/api/public/workspaces"

if ! ready_probe_only; then
  wait_http_auth "api auth" "${API_BASE%/}/api/v1/me/profile" "${TOKEN_FILE}"

  if command -v kubectl >/dev/null 2>&1; then
    if kubectl get daemonset "${CSI_DAEMONSET}" -n "${CSI_NAMESPACE}" >/dev/null 2>&1; then
      kubectl rollout status daemonset/"${CSI_DAEMONSET}" -n "${CSI_NAMESPACE}" --timeout="${TIMEOUT_SEC}s" >/dev/null
      info "csi node daemonset ready"
    fi
  fi
fi

info "stack ready"
