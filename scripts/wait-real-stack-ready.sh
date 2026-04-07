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
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
API_BASE="${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
WEB_BASE="${BASE_URL:-${RUNTIME_BROWSER_WEB_BASE_URL}}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
TIMEOUT_SEC="${READY_TIMEOUT_SEC:-180}"
SLEEP_SEC="${READY_SLEEP_SEC:-2}"
CSI_NAMESPACE="${CSI_NAMESPACE:-kube-system}"
CSI_DAEMONSET="${CSI_DAEMONSET:-juicefs-csi-node}"

info() { echo "[wait-real-stack-ready] $*"; }

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
