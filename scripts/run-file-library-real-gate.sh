#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/local-runtime-processes.sh"
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
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME:-dev-admin}"
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD:-dev-admin-123}"
API_BASE="http://localhost:${API_PORT}"
FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR="${FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real/current/file-library-real-gate}"
FILE_LIBRARY_REAL_GATE_RUN_ID="${FILE_LIBRARY_REAL_GATE_RUN_ID:-file-library-real-gate-$$}"
FILE_LIBRARY_REAL_GATE_RUNTIME_DIR="${FILE_LIBRARY_REAL_GATE_RUNTIME_DIR:-${FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR}/runtime}"
export LOCAL_RUNTIME_RUN_ID="${FILE_LIBRARY_REAL_GATE_RUN_ID}"
export LOCAL_RUNTIME_LINE_KIND="file_library_real_gate"
export LOCAL_RUNTIME_OWNER_TOKEN="${FILE_LIBRARY_REAL_GATE_RUN_ID}:file_library_real_gate:$$"
export LOCAL_RUNTIME_PROCESS_STATE_DIR="${FILE_LIBRARY_REAL_GATE_RUNTIME_DIR}/processes"
RESOURCE_RECOVERY_DIR="${FILE_LIBRARY_REAL_GATE_ARTIFACT_DIR}/resource-recovery"
RESOURCE_RECOVERY_BOOT_BASELINE_JSON="${RESOURCE_RECOVERY_DIR}/boot-baseline.json"
RESOURCE_RECOVERY_BASELINE_JSON="${RESOURCE_RECOVERY_DIR}/baseline.json"
RESOURCE_RECOVERY_STARTUP_JSON="${RESOURCE_RECOVERY_DIR}/file-library-api-startup.json"
RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON="${RESOURCE_RECOVERY_DIR}/failure-observation.json"
RESOURCE_RECOVERY_SMOKE_JSON="${RESOURCE_RECOVERY_DIR}/file-library-real-smoke.json"
RESOURCE_RECOVERY_REPORT_JSON="${RESOURCE_RECOVERY_DIR}/report.json"
RESOURCE_RECOVERY_REPORT_MD="${RESOURCE_RECOVERY_DIR}/report.md"
STARTUP_QUIESCE_SNAPSHOT_JSON="${RESOURCE_RECOVERY_DIR}/startup-quiesce.snapshot.json"
STARTUP_QUIESCE_REPORT_JSON="${RESOURCE_RECOVERY_DIR}/startup-quiesce.report.json"
STARTUP_QUIESCE_AUTHORITY_JSON="${RESOURCE_RECOVERY_DIR}/startup-quiesce.authority.json"
STARTUP_WARMUP_DIR="${FILE_LIBRARY_REAL_GATE_RUNTIME_DIR}/startup-warmup"
STARTUP_WARMUP_TOKEN_FILE="${STARTUP_WARMUP_DIR}/token.txt"
STARTUP_WARMUP_BODY_FILE="${STARTUP_WARMUP_DIR}/body.json"
STARTUP_WARMUP_HEADERS_FILE="${STARTUP_WARMUP_DIR}/headers.txt"
RESOURCE_RECOVERY_SUMMARY_WRITTEN=0
RESOURCE_RECOVERY_PRE_READY_FAILURE=0
STARTUP_QUIESCE_TIMEOUT_SECONDS="${STARTUP_QUIESCE_TIMEOUT_SECONDS:-20}"
STARTUP_QUIESCE_STABLE_SAMPLES="${STARTUP_QUIESCE_STABLE_SAMPLES:-2}"
STARTUP_QUIESCE_INTERVAL_SECONDS="${STARTUP_QUIESCE_INTERVAL_SECONDS:-1}"
STARTUP_STEADY_STATE_API_TCP_CONTRACTS=(
  "api-entry|${POSTGRES_PORT}|ESTABLISHED|0|1"
  "api-entry|${MONGO_PORT}|ESTABLISHED|4|4"
)
API_ROOT_PID=""
API_PID=""

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

mkdir -p "${RESOURCE_RECOVERY_DIR}"
mkdir -p "${LOCAL_RUNTIME_PROCESS_STATE_DIR}"
mkdir -p "${STARTUP_WARMUP_DIR}"
rm -f \
  "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}" \
  "${RESOURCE_RECOVERY_BASELINE_JSON}" \
  "${RESOURCE_RECOVERY_STARTUP_JSON}" \
  "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}" \
  "${RESOURCE_RECOVERY_SMOKE_JSON}" \
  "${RESOURCE_RECOVERY_REPORT_JSON}" \
  "${RESOURCE_RECOVERY_REPORT_MD}" \
  "${STARTUP_QUIESCE_SNAPSHOT_JSON}" \
  "${STARTUP_QUIESCE_REPORT_JSON}" \
  "${STARTUP_QUIESCE_AUTHORITY_JSON}" \
  "${STARTUP_WARMUP_TOKEN_FILE}" \
  "${STARTUP_WARMUP_BODY_FILE}" \
  "${STARTUP_WARMUP_HEADERS_FILE}"

resolve_owned_api_listener_pid() {
  [[ -n "${API_ROOT_PID}" ]] || {
    echo "File library gate has no tracked API root pid to resolve listener authority." >&2
    return 1
  }
  if ! kill -0 "${API_ROOT_PID}" >/dev/null 2>&1; then
    echo "File library gate API root pid ${API_ROOT_PID} is not alive while resolving listener authority." >&2
    return 1
  fi

  local listener_pid owner_pid
  local -a owned_listener_pids=()
  for listener_pid in $(local_runtime_port_listener_pids "${API_PORT}"); do
    [[ -n "${listener_pid}" ]] || continue
    owner_pid="$(local_runtime_verified_owner_pid_for_tree_member "${listener_pid}" api "${API_PORT}" 2>/dev/null || true)"
    [[ -n "${owner_pid}" ]] || continue
    if [[ "${owner_pid}" == "${API_ROOT_PID}" ]]; then
      owned_listener_pids+=("${listener_pid}")
    fi
  done

  if [[ "${#owned_listener_pids[@]}" -ne 1 ]]; then
    echo "File library gate expected exactly one owned API listener on port ${API_PORT}, found ${#owned_listener_pids[@]}." >&2
    return 1
  fi

  printf '%s\n' "${owned_listener_pids[0]}"
}

write_startup_listener_authority_file() {
  local output_path="$1"
  local listener_pid="$2"
  local owner_root_pid owner_root_identity listener_identity sidecar_file owner_token verified_at

  owner_root_pid="$(local_runtime_verified_owner_pid_for_tree_member "${listener_pid}" api "${API_PORT}" 2>/dev/null || true)"
  [[ -n "${owner_root_pid}" && "${owner_root_pid}" == "${API_ROOT_PID}" ]] || {
    echo "File library gate could not resolve an owned API root for listener pid ${listener_pid} while capturing startup authority." >&2
    return 1
  }

  owner_root_identity="$(local_runtime_process_identity_token "${owner_root_pid}" 2>/dev/null || true)"
  listener_identity="$(local_runtime_process_identity_token "${listener_pid}" 2>/dev/null || true)"
  [[ -n "${owner_root_identity}" && -n "${listener_identity}" ]] || {
    echo "File library gate could not capture process identity for startup authority on listener pid ${listener_pid}." >&2
    return 1
  }

  sidecar_file="$(local_runtime_find_sidecar "${owner_root_pid}" api "${API_PORT}" 2>/dev/null || true)"
  [[ -n "${sidecar_file}" ]] || {
    echo "File library gate could not locate the local runtime sidecar for startup authority on owner root pid ${owner_root_pid}." >&2
    return 1
  }
  owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token 2>/dev/null || true)"
  [[ -n "${owner_token}" ]] || {
    echo "File library gate could not read the owner token for startup authority on owner root pid ${owner_root_pid}." >&2
    return 1
  }

  verified_at="$(local_runtime_now_utc)"
  STARTUP_AUTHORITY_OUTPUT_PATH="${output_path}" \
  STARTUP_AUTHORITY_API_PORT="${API_PORT}" \
  STARTUP_AUTHORITY_OWNER_ROOT_PID="${owner_root_pid}" \
  STARTUP_AUTHORITY_OWNER_ROOT_IDENTITY="${owner_root_identity}" \
  STARTUP_AUTHORITY_OWNER_TOKEN="${owner_token}" \
  STARTUP_AUTHORITY_LISTENER_PID="${listener_pid}" \
  STARTUP_AUTHORITY_LISTENER_IDENTITY="${listener_identity}" \
  STARTUP_AUTHORITY_VERIFIED_AT="${verified_at}" \
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const outputPath = process.env.STARTUP_AUTHORITY_OUTPUT_PATH;
if (!outputPath) {
  throw new Error('STARTUP_AUTHORITY_OUTPUT_PATH is required');
}

const payload = {
  schema_version: 1,
  authority_kind: 'local_runtime_owned_api_listener',
  service_kind: 'api',
  port: Number(process.env.STARTUP_AUTHORITY_API_PORT),
  owner_root_pid: Number(process.env.STARTUP_AUTHORITY_OWNER_ROOT_PID),
  owner_root_identity: process.env.STARTUP_AUTHORITY_OWNER_ROOT_IDENTITY,
  owner_token: process.env.STARTUP_AUTHORITY_OWNER_TOKEN,
  listener_pid: Number(process.env.STARTUP_AUTHORITY_LISTENER_PID),
  listener_identity: process.env.STARTUP_AUTHORITY_LISTENER_IDENTITY,
  verified_at: process.env.STARTUP_AUTHORITY_VERIFIED_AT,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

startup_listener_authority_key_from_file() {
  local authority_path="$1"
  STARTUP_AUTHORITY_PATH="${authority_path}" node <<'NODE'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.STARTUP_AUTHORITY_PATH, 'utf8'));
const key = [
  payload.owner_root_pid ?? '',
  payload.owner_root_identity ?? '',
  payload.owner_token ?? '',
  payload.listener_pid ?? '',
  payload.listener_identity ?? '',
].join('|');
process.stdout.write(key);
NODE
}

startup_listener_authority_matches_saved_file() {
  local authority_path="$1"
  local listener_pid="$2"
  local current_authority_tmp="${authority_path}.current"

  [[ -f "${authority_path}" ]] || return 1
  rm -f "${current_authority_tmp}"
  write_startup_listener_authority_file "${current_authority_tmp}" "${listener_pid}" || {
    rm -f "${current_authority_tmp}"
    return 1
  }

  STARTUP_AUTHORITY_SAVED_PATH="${authority_path}" \
  STARTUP_AUTHORITY_CURRENT_PATH="${current_authority_tmp}" \
  node <<'NODE'
const fs = require('node:fs');

function comparable(payload) {
  return {
    authority_kind: payload.authority_kind ?? null,
    service_kind: payload.service_kind ?? null,
    port: Number.isFinite(payload.port) ? payload.port : null,
    owner_root_pid: Number.isFinite(payload.owner_root_pid) ? payload.owner_root_pid : null,
    owner_root_identity: payload.owner_root_identity ?? null,
    owner_token: payload.owner_token ?? null,
    listener_pid: Number.isFinite(payload.listener_pid) ? payload.listener_pid : null,
    listener_identity: payload.listener_identity ?? null,
  };
}

const saved = comparable(JSON.parse(fs.readFileSync(process.env.STARTUP_AUTHORITY_SAVED_PATH, 'utf8')));
const current = comparable(JSON.parse(fs.readFileSync(process.env.STARTUP_AUTHORITY_CURRENT_PATH, 'utf8')));
if (JSON.stringify(saved) !== JSON.stringify(current)) {
  process.exitCode = 1;
}
NODE
  local status=$?
  rm -f "${current_authority_tmp}"
  return ${status}
}

append_startup_steady_state_args() {
  local -n startup_args_ref="$1"
  local contract
  for contract in "${STARTUP_STEADY_STATE_API_TCP_CONTRACTS[@]}"; do
    startup_args_ref+=(--steady-state-api-tcp "${contract}")
  done
}

perform_startup_authenticated_docstore_warmup() {
  REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 PRINT_TOKEN=1 \
  MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME}" \
  MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  node "${ROOT_DIR}/scripts/agent-runner-refresh-token.js" > "${STARTUP_WARMUP_TOKEN_FILE}"

  local status
  status="$(
    curl -sS -D "${STARTUP_WARMUP_HEADERS_FILE}" -o "${STARTUP_WARMUP_BODY_FILE}" -w '%{http_code}' \
      -H "Authorization: Bearer $(cat "${STARTUP_WARMUP_TOKEN_FILE}")" \
      "${API_BASE%/}/api/v1/workspaces/ws_default/projects/proj_1/file-libraries"
  )"
  if [[ "${status}" != "200" ]]; then
    echo "File library gate startup warmup failed with status ${status} for GET /api/v1/workspaces/ws_default/projects/proj_1/file-libraries." >&2
    cat "${STARTUP_WARMUP_BODY_FILE}" >&2 || true
    return 1
  fi
  return 0
}

startup_quiesce_snapshot_satisfies_steady_state() {
  local listener_pid="$1"
  local snapshot_tmp="${STARTUP_QUIESCE_SNAPSHOT_JSON}.tmp"
  local report_tmp="${STARTUP_QUIESCE_REPORT_JSON}.tmp"
  local authority_tmp="${STARTUP_QUIESCE_AUTHORITY_JSON}.tmp"
  local -a snapshot_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    snapshot
    --output "${snapshot_tmp}"
    --api-pid "${listener_pid}"
  )
  local -a startup_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    startup-report
    --boot-baseline "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"
    --startup-candidate "${snapshot_tmp}"
    --comparison-current-source startup_candidate
    --output "${report_tmp}"
  )
  append_startup_steady_state_args startup_args

  rm -f "${snapshot_tmp}" "${report_tmp}" "${authority_tmp}"
  npx "${snapshot_args[@]}" >/dev/null 2>&1 || return 1
  write_startup_listener_authority_file "${authority_tmp}" "${listener_pid}" >/dev/null 2>&1 || {
    rm -f "${snapshot_tmp}" "${report_tmp}" "${authority_tmp}"
    return 1
  }

  local startup_status=0
  set +e
  npx "${startup_args[@]}" >/dev/null 2>&1
  startup_status=$?
  set -e

  if [[ -f "${snapshot_tmp}" && -f "${report_tmp}" && -f "${authority_tmp}" ]]; then
    mv "${snapshot_tmp}" "${STARTUP_QUIESCE_SNAPSHOT_JSON}"
    mv "${report_tmp}" "${STARTUP_QUIESCE_REPORT_JSON}"
    mv "${authority_tmp}" "${STARTUP_QUIESCE_AUTHORITY_JSON}"
  else
    rm -f "${snapshot_tmp}" "${report_tmp}" "${authority_tmp}"
    return 1
  fi

  [[ "${startup_status}" -eq 0 ]]
}

wait_for_startup_quiesce() {
  local deadline=$((SECONDS + STARTUP_QUIESCE_TIMEOUT_SECONDS))
  local stable_samples=0
  local listener_pid=""
  local last_authority_key=""
  local current_authority_key=""

  while (( SECONDS <= deadline )); do
    listener_pid="$(resolve_owned_api_listener_pid 2>/dev/null || true)"
    if [[ -n "${listener_pid}" ]]; then
      API_PID="${listener_pid}"
      if startup_quiesce_snapshot_satisfies_steady_state "${listener_pid}"; then
        current_authority_key="$(startup_listener_authority_key_from_file "${STARTUP_QUIESCE_AUTHORITY_JSON}" 2>/dev/null || true)"
        if [[ -n "${current_authority_key}" && "${current_authority_key}" == "${last_authority_key}" ]]; then
          stable_samples=$((stable_samples + 1))
        else
          stable_samples=1
          last_authority_key="${current_authority_key}"
        fi
        if (( stable_samples >= STARTUP_QUIESCE_STABLE_SAMPLES )); then
          return 0
        fi
      else
        stable_samples=0
        last_authority_key=""
      fi
    else
      stable_samples=0
      last_authority_key=""
    fi
    sleep "${STARTUP_QUIESCE_INTERVAL_SECONDS}"
  done

  return 1
}

freeze_startup_ready_baseline_from_quiesce_proof() {
  [[ -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" && -f "${STARTUP_QUIESCE_REPORT_JSON}" && -f "${STARTUP_QUIESCE_AUTHORITY_JSON}" ]] || {
    echo "File library gate is missing the proven startup candidate snapshot/report needed to freeze the ready baseline." >&2
    return 1
  }

  local current_listener_pid=""
  current_listener_pid="$(resolve_owned_api_listener_pid 2>/dev/null || true)"
  [[ -n "${current_listener_pid}" ]] || {
    echo "File library gate could not resolve the current owned API listener while freezing the ready baseline." >&2
    return 1
  }
  startup_listener_authority_matches_saved_file "${STARTUP_QUIESCE_AUTHORITY_JSON}" "${current_listener_pid}" || {
    echo "File library gate startup listener handoff changed authority after steady-state proof and before ready baseline freeze." >&2
    return 1
  }

  API_PID="${current_listener_pid}"
  cp "${STARTUP_QUIESCE_SNAPSHOT_JSON}" "${RESOURCE_RECOVERY_BASELINE_JSON}"
}

build_file_library_api_launch_command() {
  local command
  printf -v command '%s' "export PORT=$(printf '%q' "${API_PORT}")"
  printf -v command '%s%s' "${command}" " KEYCLOAK_BASE_URL=$(printf '%q' "${KEYCLOAK_BASE_URL}")"
  printf -v command '%s%s' "${command}" " KEYCLOAK_REALM=$(printf '%q' "${KEYCLOAK_REALM}")"
  printf -v command '%s%s' "${command}" " PUBLIC_KEYCLOAK_BASE_URL=$(printf '%q' "${PUBLIC_KEYCLOAK_BASE_URL}")"
  printf -v command '%s%s' "${command}" " INTERNAL_KEYCLOAK_BASE_URL=$(printf '%q' "${INTERNAL_KEYCLOAK_BASE_URL}")"
  printf -v command '%s%s' "${command}" " KEYCLOAK_ISSUER_URL=$(printf '%q' "${KEYCLOAK_ISSUER_URL}")"
  printf -v command '%s%s' "${command}" " DATABASE_URL=$(printf '%q' "${DATABASE_URL}")"
  printf -v command '%s%s' "${command}" " MONGO_URL=$(printf '%q' "${MONGO_URL}")"
  printf -v command '%s%s' "${command}" " MINIO_ENDPOINT=$(printf '%q' "${MINIO_ENDPOINT}")"
  printf -v command '%s%s' "${command}" " MINIO_PORT=$(printf '%q' "${MINIO_PORT}")"
  printf -v command '%s%s' "${command}" " MINIO_ACCESS_KEY=$(printf '%q' "${MINIO_ACCESS_KEY}")"
  printf -v command '%s%s' "${command}" " MINIO_SECRET_KEY=$(printf '%q' "${MINIO_SECRET_KEY}")"
  printf -v command '%s%s' "${command}" " MINIO_BUCKET=$(printf '%q' "${MINIO_BUCKET}")"
  printf -v command '%s%s' "${command}" '; env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY npm run api:node:dev & wait "$!"'
  printf '%s\n' "${command}"
}

capture_resource_recovery_baseline() {
  local output_path="$1"
  local -a snapshot_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    snapshot
    --output "${output_path}"
  )

  if [[ -n "${API_PID}" ]]; then
    API_PID="$(resolve_owned_api_listener_pid)"
    local -a api_snapshot_args=("${snapshot_args[@]}" --api-pid "${API_PID}")
    # Once we claim the tracked API pid as the authority boundary, losing it
    # mid-capture is a hard failure rather than a reason to silently downgrade
    # into an untracked snapshot.
    npx "${api_snapshot_args[@]}"
    return 0
  fi

  npx "${snapshot_args[@]}"
}

write_startup_resource_recovery_report() {
  local failure_message="${1:-}"
  shift || true
  local -a startup_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    startup-report
    --boot-baseline "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"
    --output "${RESOURCE_RECOVERY_STARTUP_JSON}"
  )
  if [[ "$#" -gt 0 ]]; then
    startup_args+=("$@")
  else
    startup_args+=(
      --ready-baseline "${RESOURCE_RECOVERY_BASELINE_JSON}"
      --comparison-current-source ready_baseline
    )
    if [[ -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" ]]; then
      startup_args+=(--startup-candidate "${STARTUP_QUIESCE_SNAPSHOT_JSON}")
    fi
  fi
  append_startup_steady_state_args startup_args
  if [[ -n "${failure_message}" ]]; then
    startup_args+=(--failure-message "${failure_message}")
  fi
  npx "${startup_args[@]}"
}

ensure_boot_resource_recovery_baseline() {
  if [[ -f "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}" ]]; then
    return 0
  fi

  npx tsx "${ROOT_DIR}/scripts/file-library-resource-recovery.ts" \
    snapshot \
    --output "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"
}

materialize_pre_ready_failure_evidence() {
  local failure_message="$1"
  local current_listener_pid=""
  local capture_status=0
  local -a startup_candidate_args=()
  RESOURCE_RECOVERY_PRE_READY_FAILURE=1
  ensure_boot_resource_recovery_baseline

  set +e
  capture_resource_recovery_baseline "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"
  capture_status=$?
  set -e
  if [[ "${capture_status}" -ne 0 ]]; then
    local -a plain_snapshot_args=(
      tsx
      "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
      snapshot
      --output "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"
    )
    set +e
    npx "${plain_snapshot_args[@]}"
    capture_status=$?
    set -e
  fi
  if [[ -f "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}" ]]; then
    startup_candidate_args+=(--failure-observation "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}")
  fi

  if [[ -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" && -f "${STARTUP_QUIESCE_AUTHORITY_JSON}" ]]; then
    startup_candidate_args+=(--startup-candidate "${STARTUP_QUIESCE_SNAPSHOT_JSON}")
    current_listener_pid="$(resolve_owned_api_listener_pid 2>/dev/null || true)"
    if [[ -n "${current_listener_pid}" ]] \
      && startup_listener_authority_matches_saved_file "${STARTUP_QUIESCE_AUTHORITY_JSON}" "${current_listener_pid}"; then
      startup_candidate_args+=(--comparison-current-source startup_candidate)
    else
      startup_candidate_args+=(--comparison-current-source failure_observation)
    fi
  else
    startup_candidate_args+=(--comparison-current-source failure_observation)
  fi

  if write_startup_resource_recovery_report "${failure_message}" "${startup_candidate_args[@]}"; then
    return 0
  fi
  [[ -f "${RESOURCE_RECOVERY_STARTUP_JSON}" ]]
}

write_resource_recovery_summary() {
  local -a extra_summary_args=("$@")
  if [[ ! -f "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}" ]]; then
    return 0
  fi

  local -a report_paths
  if [[ "${RESOURCE_RECOVERY_PRE_READY_FAILURE}" == "1" ]]; then
    report_paths=("${RESOURCE_RECOVERY_STARTUP_JSON}")
  else
    report_paths=(
      "${RESOURCE_RECOVERY_STARTUP_JSON}"
      "${RESOURCE_RECOVERY_SMOKE_JSON}"
    )
  fi

  local report_path
  for report_path in "${report_paths[@]}"; do
    if [[ ! -f "${report_path}" ]]; then
      echo "File library gate missing required recovery report: ${report_path}" >&2
      return 1
    fi
  done

  local -a summary_args=(
    tsx
    "${ROOT_DIR}/scripts/file-library-resource-recovery.ts"
    summary
    --boot-baseline "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"
    --output-json "${RESOURCE_RECOVERY_REPORT_JSON}"
    --output-markdown "${RESOURCE_RECOVERY_REPORT_MD}"
  )
  if [[ -f "${RESOURCE_RECOVERY_BASELINE_JSON}" ]]; then
    summary_args+=(--ready-baseline "${RESOURCE_RECOVERY_BASELINE_JSON}")
  fi
  if [[ -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" ]]; then
    summary_args+=(--startup-candidate "${STARTUP_QUIESCE_SNAPSHOT_JSON}")
  fi
  if [[ -f "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}" ]]; then
    summary_args+=(--failure-observation "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}")
  fi
  for report_path in "${report_paths[@]}"; do
    summary_args+=(--report "${report_path}")
  done
  if [[ "${#extra_summary_args[@]}" -gt 0 ]]; then
    summary_args+=("${extra_summary_args[@]}")
  fi

  npx "${summary_args[@]}"
  RESOURCE_RECOVERY_SUMMARY_WRITTEN=1
}

cleanup() {
  local exit_code="$1"
  local summary_status=0
  local cleanup_stop_status=0
  local cleanup_wait_status=0
  local -a summary_extra_args=()
  trap - EXIT
  if [[ "${RESOURCE_RECOVERY_SUMMARY_WRITTEN}" != "1" ]]; then
    set +e
    write_resource_recovery_summary
    summary_status=$?
    set -e
  fi
  if [[ -n "${API_ROOT_PID}" ]]; then
    set +e
    local_runtime_stop_owned_process_tree "${API_ROOT_PID}" api "${API_PORT}"
    cleanup_stop_status=$?
    local_runtime_wait_port_free "${API_PORT}" api 10
    cleanup_wait_status=$?
    set -e
  fi
  if [[ "${cleanup_stop_status}" -ne 0 ]]; then
    summary_extra_args+=(
      --extra-finding
      "cleanup failed to stop the owned api process tree on port ${API_PORT} with exit code ${cleanup_stop_status}"
    )
  fi
  if [[ "${cleanup_wait_status}" -ne 0 ]]; then
    summary_extra_args+=(
      --extra-finding
      "cleanup failed to confirm api port ${API_PORT} became free after stopping the owned api process tree with exit code ${cleanup_wait_status}"
    )
  fi
  if [[ "${#summary_extra_args[@]}" -gt 0 ]]; then
    set +e
    write_resource_recovery_summary "${summary_extra_args[@]}"
    summary_status=$?
    set -e
  fi
  if [[ "${summary_status}" -ne 0 || "${cleanup_stop_status}" -ne 0 || "${cleanup_wait_status}" -ne 0 ]]; then
    exit_code=1
  fi
  exit "${exit_code}"
}
trap 'cleanup $?' EXIT

ensure_boot_resource_recovery_baseline

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
    --api-pid "${API_PID}"
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
      --api-pid "${API_PID}"
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
API_ROOT_PID="$(
  local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}" bash -lc "$(build_file_library_api_launch_command)"
)"

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
  pre_ready_failure_reason="file-library gate api did not become ready in time (last status: ${code:-n/a})"
  if ! materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"; then
    echo "File library gate could not materialize startup resource recovery evidence before exiting." >&2
  fi
  echo "File library gate API did not become ready in time (last status: ${code:-n/a})." >&2
  echo "API log: ${API_LOG}" >&2
  exit 1
fi

if ! API_PID="$(resolve_owned_api_listener_pid)"; then
  pre_ready_failure_reason="file-library gate api listener on :${API_PORT} did not resolve to the current owned service"
  if ! materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"; then
    echo "File library gate could not materialize startup resource recovery evidence before exiting." >&2
  fi
  echo "File library gate API listener on :${API_PORT} did not resolve to the current owned service." >&2
  echo "API log: ${API_LOG}" >&2
  exit 1
fi

if ! perform_startup_authenticated_docstore_warmup; then
  pre_ready_failure_reason="file-library gate authenticated docStore warmup failed before freezing the ready baseline"
  if ! materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"; then
    echo "File library gate could not materialize startup resource recovery evidence before exiting." >&2
  fi
  exit 1
fi

if ! wait_for_startup_quiesce; then
  pre_ready_failure_reason="file-library gate startup quiesce did not settle before the declared steady-state contract"
  if ! materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"; then
    echo "File library gate could not materialize startup resource recovery evidence before exiting." >&2
  fi
  exit 1
fi
if ! freeze_startup_ready_baseline_from_quiesce_proof; then
  pre_ready_failure_reason="file-library gate startup listener handoff changed authority after steady-state proof and before ready baseline freeze"
  if ! materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"; then
    echo "File library gate could not materialize startup resource recovery evidence before exiting." >&2
  fi
  exit 1
fi

overall_status=0
if ! write_startup_resource_recovery_report; then
  overall_status=1
fi

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

write_resource_recovery_summary
printf 'File library resource recovery report: %s\n' "${RESOURCE_RECOVERY_REPORT_MD}"
if [[ "${overall_status}" -ne 0 ]]; then
  exit 1
fi
