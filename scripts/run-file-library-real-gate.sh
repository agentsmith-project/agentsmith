#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
load_backend_real_env

resolve_reachable_keycloak_base() {
  local realm="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ -n "${candidate}" ]] || continue
    if curl -fsS "${candidate%/}/realms/${realm}/.well-known/openid-configuration" >/dev/null 2>&1; then
      printf '%s\n' "${candidate%/}"
      return 0
    fi
  done
  return 1
}

resolve_reachable_tcp_port() {
  local host="$1"
  shift
  local port
  for port in "$@"; do
    [[ -n "${port}" ]] || continue
    if node -e '
      const host = process.argv[1];
      const port = Number.parseInt(process.argv[2], 10);
      const net = require("node:net");
      const socket = net.createConnection({ host, port });
      const timeout = setTimeout(() => {
        socket.destroy();
        process.exit(1);
      }, 1500);
      socket.on("connect", () => {
        clearTimeout(timeout);
        socket.end();
        process.exit(0);
      });
      socket.on("error", () => {
        clearTimeout(timeout);
        process.exit(1);
      });
    ' "${host}" "${port}" >/dev/null 2>&1; then
      printf '%s\n' "${port}"
      return 0
    fi
  done
  return 1
}

API_PORT="${FILE_LIBRARY_GATE_API_PORT:-21010}"
API_LOG="${FILE_LIBRARY_GATE_API_LOG:-/tmp/agentsmith-file-library-gate-api.log}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-18080}}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT:-3001}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
KEYCLOAK_BASE_URL="$(
  resolve_reachable_keycloak_base "${KEYCLOAK_REALM}" \
    "${KEYCLOAK_BASE_URL:-}" \
    "${PUBLIC_KEYCLOAK_BASE_URL:-}" \
    "${INTERNAL_KEYCLOAK_BASE_URL:-}" \
    "${RUNTIME_HOST_KEYCLOAK_BASE_URL:-}" \
    "${RUNTIME_BROWSER_KEYCLOAK_BASE_URL:-}" \
    "http://127.0.0.1:18080" \
    "http://localhost:18080"
)" || {
  echo "File library gate could not resolve a reachable Keycloak loopback base." >&2
  exit 1
}
PUBLIC_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}"
INTERNAL_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}"
KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-$(
  resolve_reachable_tcp_port "${POSTGRES_HOST}" "${INTEGRATION_POSTGRES_PORT:-}" "15432"
)}" || {
  echo "File library gate could not resolve a reachable PostgreSQL loopback port." >&2
  exit 1
}
MONGO_HOST="${MONGO_HOST:-localhost}"
MONGO_PORT="${MONGO_PORT:-$(
  resolve_reachable_tcp_port "${MONGO_HOST}" "${INTEGRATION_MONGO_PORT:-}" "17017"
)}" || {
  echo "File library gate could not resolve a reachable MongoDB loopback port." >&2
  exit 1
}
MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-$(
  resolve_reachable_tcp_port "${MINIO_ENDPOINT}" "${INTEGRATION_MINIO_API_PORT:-}" "19000"
)}" || {
  echo "File library gate could not resolve a reachable MinIO loopback port." >&2
  exit 1
}
DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@${POSTGRES_HOST}:${POSTGRES_PORT}/mbos}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@${MONGO_HOST}:${MONGO_PORT}/admin}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
API_BASE="http://localhost:${API_PORT}"
FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR="${FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real/current/file-library-real-gate}"
RESOURCE_RECOVERY_DIR="${FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR}/resource-recovery"
RESOURCE_RECOVERY_BASELINE_JSON="${RESOURCE_RECOVERY_DIR}/baseline.json"
RESOURCE_RECOVERY_SMOKE_JSON="${RESOURCE_RECOVERY_DIR}/file-library-real-smoke.json"
RESOURCE_RECOVERY_MOUNT_SYNC_JSON="${RESOURCE_RECOVERY_DIR}/file-library-mount-sync-smoke.json"
RESOURCE_RECOVERY_MOUNT_SYNC_PROBE_JSON="${RESOURCE_RECOVERY_DIR}/file-library-mount-sync-probe.json"
RESOURCE_RECOVERY_REPORT_JSON="${RESOURCE_RECOVERY_DIR}/report.json"
RESOURCE_RECOVERY_REPORT_MD="${RESOURCE_RECOVERY_DIR}/report.md"
RESOURCE_RECOVERY_SUMMARY_WRITTEN=0

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

mkdir -p "${RESOURCE_RECOVERY_DIR}"

write_resource_recovery_summary() {
  if [[ ! -f "${RESOURCE_RECOVERY_BASELINE_JSON}" ]]; then
    return 0
  fi

  local report_path
  for report_path in "${RESOURCE_RECOVERY_SMOKE_JSON}" "${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}"; do
    if [[ ! -f "${report_path}" ]]; then
      echo "File library gate missing required recovery report: ${report_path}" >&2
      return 1
    fi
  done

  npx tsx "${ROOT_DIR}/scripts/file-library-resource-recovery.ts" \
    summary \
    --baseline "${RESOURCE_RECOVERY_BASELINE_JSON}" \
    --output-json "${RESOURCE_RECOVERY_REPORT_JSON}" \
    --output-markdown "${RESOURCE_RECOVERY_REPORT_MD}" \
    --report "${RESOURCE_RECOVERY_SMOKE_JSON}" \
    --report "${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}"
  RESOURCE_RECOVERY_SUMMARY_WRITTEN=1
}

run_resource_recovery_step() {
  local step_name="$1"
  local report_path="$2"
  local probe_path="$3"
  shift 3

  local smoke_status=0
  local smoke_message=""
  set +e
  "$@"
  smoke_status=$?
  set -e
  if [[ "${smoke_status}" -ne 0 ]]; then
    smoke_message="${step_name} exited with status ${smoke_status}"
  fi

  local verify_status=0
  local fallback_status=0
  local verify_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    verify
    --baseline "${RESOURCE_RECOVERY_BASELINE_JSON}"
    --step "${step_name}"
    --output "${report_path}"
    --smoke-status "${smoke_status}"
  )
  if [[ -n "${smoke_message}" ]]; then
    verify_args+=(--smoke-message "${smoke_message}")
  fi
  if [[ -n "${probe_path}" ]]; then
    verify_args+=(--probe "${probe_path}")
  fi

  set +e
  npx "${verify_args[@]}"
  verify_status=$?
  set -e

  if [[ ! -f "${report_path}" ]]; then
    local fallback_reason="resource recovery verify did not write the step report for ${step_name}"
    if [[ "${verify_status}" -ne 0 ]]; then
      fallback_reason="resource recovery verify exited with status ${verify_status} before writing the step report for ${step_name}"
    fi
    local fallback_args=(
      tsx
      "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
      fallback-report
      --baseline "${RESOURCE_RECOVERY_BASELINE_JSON}"
      --step "${step_name}"
      --output "${report_path}"
      --reason "${fallback_reason}"
      --smoke-status "${smoke_status}"
    )
    if [[ -n "${smoke_message}" ]]; then
      fallback_args+=(--smoke-message "${smoke_message}")
    fi
    if [[ -n "${probe_path}" ]]; then
      fallback_args+=(--probe "${probe_path}")
    fi

    set +e
    npx "${fallback_args[@]}"
    fallback_status=$?
    set -e
  fi

  if [[ ! -f "${report_path}" ]]; then
    echo "File library gate missing required recovery report: ${report_path}" >&2
    return 1
  fi

  if [[ "${smoke_status}" -ne 0 || "${verify_status}" -ne 0 || "${fallback_status}" -ne 0 ]]; then
    return 1
  fi

  return 0
}

PORT="${API_PORT}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
DATABASE_URL="${DATABASE_URL}" \
MONGO_URL="${MONGO_URL}" \
MINIO_ENDPOINT="${MINIO_ENDPOINT}" \
MINIO_PORT="${MINIO_PORT}" \
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
MINIO_BUCKET="${MINIO_BUCKET}" \
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
npm run api:node:dev >"${API_LOG}" 2>&1 &
API_PID=$!

cleanup() {
  local exit_code="$1"
  local summary_status=0
  trap - EXIT
  if [[ "${RESOURCE_RECOVERY_SUMMARY_WRITTEN}" != "1" ]]; then
    set +e
    write_resource_recovery_summary
    summary_status=$?
    set -e
  fi
  kill "${API_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
  if [[ "${summary_status}" -ne 0 ]]; then
    exit_code=1
  fi
  exit "${exit_code}"
}
trap 'cleanup $?' EXIT

ready=0
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/public/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "File library gate API did not become ready in time (last status: ${code:-n/a})." >&2
  echo "API log: ${API_LOG}" >&2
  exit 1
fi

npx tsx "${ROOT_DIR}/scripts/file-library-resource-recovery.ts" \
  snapshot \
  --output "${RESOURCE_RECOVERY_BASELINE_JSON}"

overall_status=0
if ! run_resource_recovery_step "file-library-real-smoke" "${RESOURCE_RECOVERY_SMOKE_JSON}" "" \
  env \
    API_BASE="${API_BASE}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
    PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
    INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
    KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
    INTEGRATION_KEYCLOAK_PORT="${KEYCLOAK_PORT}" \
    bash "${ROOT_DIR}/scripts/file-library-real-smoke.sh"; then
  overall_status=1
fi

if ! run_resource_recovery_step "file-library-mount-sync-smoke" "${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}" "${RESOURCE_RECOVERY_MOUNT_SYNC_PROBE_JSON}" \
  env \
    API_BASE="${API_BASE}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
    PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
    INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
    KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
    INTEGRATION_KEYCLOAK_PORT="${KEYCLOAK_PORT}" \
    FILE_LIBRARY_RESOURCE_RECOVERY_PROBE_PATH="${RESOURCE_RECOVERY_MOUNT_SYNC_PROBE_JSON}" \
    bash "${ROOT_DIR}/scripts/file-library-mount-sync-smoke.sh"; then
  overall_status=1
fi

write_resource_recovery_summary
printf 'File library resource recovery report: %s\n' "${RESOURCE_RECOVERY_REPORT_MD}"
if [[ "${overall_status}" -ne 0 ]]; then
  exit 1
fi
