#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"

ensure_dirs
mkdir -p "${RELEASE_ROOT}/env"

SITE_ENV="${RELEASE_ROOT}/env/site.env"
[[ -f "${SITE_ENV}" ]] || cp "${RELEASE_ROOT}/env/site.env.example" "${SITE_ENV}"

set -a
load_env_file "${SITE_ENV}"
set +a

DEMO_DEPLOY_MODE="$(demo_deploy_mode)"

require_nonempty() {
  local key="$1"
  local value="${!key:-}"
  [[ -n "${value}" ]] || die "missing required site.env value: ${key}"
}

resolve_runner_host() {
  if [[ -n "${RESOLVED_RUNNER_HOST:-}" ]]; then
    printf '%s\n' "${RESOLVED_RUNNER_HOST}"
    return 0
  fi

  local compose_file=""
  if [[ -f "${RELEASE_ROOT}/compose/docker-compose.yml" ]]; then
    compose_file="${RELEASE_ROOT}/compose/docker-compose.yml"
  elif [[ -f "${ROOT_DIR}/infra/deploy/demo/docker-compose.yml" ]]; then
    compose_file="${ROOT_DIR}/infra/deploy/demo/docker-compose.yml"
  fi

  if [[ -n "${compose_file}" ]] && grep -Fq 'host.docker.internal:host-gateway' "${compose_file}"; then
    printf 'host.docker.internal\n'
    return 0
  fi

  die "unable to resolve runner host; set RESOLVED_RUNNER_HOST or provide a compose-managed host alias"
}

for required_key in \
  PUBLIC_API_BASE_URL \
  COMPOSE_INTERNAL_API_BASE_URL \
  COMPOSE_INTERNAL_KEYCLOAK_BASE_URL \
  HOST_LOCAL_POSTGRES_HOST \
  HOST_LOCAL_POSTGRES_PORT \
  HOST_LOCAL_MINIO_ENDPOINT \
  SANDBOX_HOST_PORT \
  API_PORT \
  MINIO_API_PORT; do
  require_nonempty "${required_key}"
done

runner_host="$(resolve_runner_host)"
[[ -n "${runner_host}" ]] || die "resolved runner host is empty"

kind_gateway_host="${RESOLVED_KIND_GATEWAY_HOST:-}"
if [[ -z "${kind_gateway_host}" ]]; then
  if demo_mode_is_simple; then
    kind_gateway_host="simple-mode-disabled.invalid"
  elif detect_kind_gateway_ip >/dev/null 2>&1; then
    kind_gateway_host="$(detect_kind_gateway_ip)"
  elif [[ "${ALLOW_UNRESOLVED_KIND_GATEWAY:-0}" == "1" ]]; then
    kind_gateway_host="kind-gateway-unresolved.invalid"
  else
    die "unable to resolve kind gateway host; create the kind cluster first or set RESOLVED_KIND_GATEWAY_HOST"
  fi
fi

cat > "${RELEASE_ROOT}/env/runtime-addresses.env" <<EOF
RESOLVED_RUNNER_HOST=${runner_host}
RESOLVED_RUNNER_HTTP_BASE_URL=http://${runner_host}:${API_PORT}
RESOLVED_RUNNER_WS_BASE_URL=ws://${runner_host}:${API_PORT}
RESOLVED_SANDBOX_MANAGER_URL=http://${runner_host}:${SANDBOX_HOST_PORT}
RESOLVED_KIND_GATEWAY_HOST=${kind_gateway_host}
RESOLVED_KIND_HTTP_BASE_URL=http://${kind_gateway_host}:${API_PORT}
RESOLVED_KIND_WS_BASE_URL=ws://${kind_gateway_host}:${API_PORT}
RESOLVED_LOCAL_FILE_LIBRARY_POSTGRES_HOST=${HOST_LOCAL_POSTGRES_HOST}
RESOLVED_LOCAL_FILE_LIBRARY_POSTGRES_PORT=${HOST_LOCAL_POSTGRES_PORT}
RESOLVED_LOCAL_FILE_LIBRARY_MINIO_ENDPOINT=${HOST_LOCAL_MINIO_ENDPOINT}
EOF

log "resolve-runtime-addresses ok"
