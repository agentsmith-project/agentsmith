#!/usr/bin/env bash
set -euo pipefail

RUNTIME_VERIFICATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_VERIFICATION_ROOT="$(cd "${RUNTIME_VERIFICATION_DIR}/../.." && pwd)"

resolve_loopback_runtime_addresses() {
  local api_port="${1}"
  local web_port="${2}"
  local keycloak_port="${3}"

  RUNTIME_HOST_API_BASE_URL="${RUNTIME_HOST_API_BASE_URL:-http://127.0.0.1:${api_port}}"
  RUNTIME_BROWSER_WEB_BASE_URL="${RUNTIME_BROWSER_WEB_BASE_URL:-http://localhost:${web_port}}"
  RUNTIME_HOST_WEB_BASE_URL="${RUNTIME_HOST_WEB_BASE_URL:-http://127.0.0.1:${web_port}}"
  RUNTIME_BROWSER_KEYCLOAK_BASE_URL="${RUNTIME_BROWSER_KEYCLOAK_BASE_URL:-http://localhost:${keycloak_port}}"
  RUNTIME_HOST_KEYCLOAK_BASE_URL="${RUNTIME_HOST_KEYCLOAK_BASE_URL:-http://127.0.0.1:${keycloak_port}}"

  export \
    RUNTIME_HOST_API_BASE_URL \
    RUNTIME_BROWSER_WEB_BASE_URL \
    RUNTIME_HOST_WEB_BASE_URL \
    RUNTIME_BROWSER_KEYCLOAK_BASE_URL \
    RUNTIME_HOST_KEYCLOAK_BASE_URL
}

resolve_public_runtime_addresses() {
  local public_web="${1}"
  local public_api="${2}"
  local public_keycloak="${3}"
  local host_web="${4}"
  local host_api="${5}"
  local host_keycloak="${6}"

  RUNTIME_PUBLIC_WEB_BASE_URL="${RUNTIME_PUBLIC_WEB_BASE_URL:-${public_web}}"
  RUNTIME_PUBLIC_API_BASE_URL="${RUNTIME_PUBLIC_API_BASE_URL:-${public_api}}"
  RUNTIME_PUBLIC_KEYCLOAK_BASE_URL="${RUNTIME_PUBLIC_KEYCLOAK_BASE_URL:-${public_keycloak}}"
  RUNTIME_HOST_WEB_BASE_URL="${RUNTIME_HOST_WEB_BASE_URL:-${host_web}}"
  RUNTIME_HOST_API_BASE_URL="${RUNTIME_HOST_API_BASE_URL:-${host_api}}"
  RUNTIME_HOST_KEYCLOAK_BASE_URL="${RUNTIME_HOST_KEYCLOAK_BASE_URL:-${host_keycloak}}"
  RUNTIME_BROWSER_WEB_BASE_URL="${RUNTIME_BROWSER_WEB_BASE_URL:-${RUNTIME_PUBLIC_WEB_BASE_URL}}"
  RUNTIME_BROWSER_KEYCLOAK_BASE_URL="${RUNTIME_BROWSER_KEYCLOAK_BASE_URL:-${RUNTIME_PUBLIC_KEYCLOAK_BASE_URL}}"

  export \
    RUNTIME_PUBLIC_WEB_BASE_URL \
    RUNTIME_PUBLIC_API_BASE_URL \
    RUNTIME_PUBLIC_KEYCLOAK_BASE_URL \
    RUNTIME_HOST_WEB_BASE_URL \
    RUNTIME_HOST_API_BASE_URL \
    RUNTIME_HOST_KEYCLOAK_BASE_URL \
    RUNTIME_BROWSER_WEB_BASE_URL \
    RUNTIME_BROWSER_KEYCLOAK_BASE_URL
}

resolve_runtime_identity_env() {
  local default_keycloak_base_url="$1"
  local default_keycloak_realm="${2:-mbos}"
  local default_keycloak_client_id="${3:-agentsmith}"

  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-${default_keycloak_base_url}}"
  KEYCLOAK_REALM="${KEYCLOAK_REALM:-${default_keycloak_realm}}"
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-${default_keycloak_client_id}}"
  KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_BASE_URL%/}/realms}"
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"

  export \
    KEYCLOAK_BASE_URL \
    KEYCLOAK_REALM \
    KEYCLOAK_CLIENT_ID \
    KEYCLOAK_URL \
    PUBLIC_KEYCLOAK_BASE_URL \
    INTERNAL_KEYCLOAK_BASE_URL \
    KEYCLOAK_ISSUER_URL
}

resolve_loopback_runtime_stack() {
  local api_port="$1"
  local web_port="$2"
  local keycloak_port="$3"
  local default_keycloak_realm="${4:-mbos}"
  local default_keycloak_client_id="${5:-agentsmith}"

  resolve_loopback_runtime_addresses "${api_port}" "${web_port}" "${keycloak_port}"
  resolve_runtime_identity_env \
    "${RUNTIME_BROWSER_KEYCLOAK_BASE_URL}" \
    "${default_keycloak_realm}" \
    "${default_keycloak_client_id}"
}

resolve_public_runtime_stack() {
  local public_web="$1"
  local public_api="$2"
  local public_keycloak="$3"
  local host_web="$4"
  local host_api="$5"
  local host_keycloak="$6"
  local default_keycloak_realm="${7:-mbos}"
  local default_keycloak_client_id="${8:-agentsmith}"

  resolve_public_runtime_addresses \
    "${public_web}" \
    "${public_api}" \
    "${public_keycloak}" \
    "${host_web}" \
    "${host_api}" \
    "${host_keycloak}"
  resolve_runtime_identity_env \
    "${RUNTIME_BROWSER_KEYCLOAK_BASE_URL}" \
    "${default_keycloak_realm}" \
    "${default_keycloak_client_id}"
}

gate_evidence_init() {
  local evidence_dir="$1"
  local line_kind="$2"
  mkdir -p "${evidence_dir}" "${evidence_dir}/logs" "${evidence_dir}/runner" "${evidence_dir}/playwright"
  printf '{\n  "line_kind": "%s",\n  "checks": []\n}\n' "${line_kind}" > "${evidence_dir}/preflight.json"
  printf '{\n  "classification": "pending",\n  "stage": "bootstrap",\n  "message": ""\n}\n' > "${evidence_dir}/failure-classification.json"
  printf '{\n  "samples": []\n}\n' > "${evidence_dir}/workspace-access.json"
  printf '{\n  "services": []\n}\n' > "${evidence_dir}/service-status.json"
  printf '{\n  "tasks": []\n}\n' > "${evidence_dir}/task-summary.json"
  : > "${evidence_dir}/mount-tree.txt"
}

gate_write_runtime_descriptor() {
  local evidence_dir="$1"
  local line_kind="$2"
  node - <<'NODE' "${evidence_dir}/runtime.json" "${line_kind}"
const fs = require('node:fs');
const path = require('node:path');
const [file, lineKind] = process.argv.slice(2);
const env = process.env;
const lineId =
  (env.RUNTIME_LINE_ID && env.RUNTIME_LINE_ID.trim())
  || (env.RELEASE_ID && env.RELEASE_ID.trim())
  || path.basename(path.dirname(file));
function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
const runtime = {
  line_id: lineId,
  line_kind: lineKind,
  runner_modes: splitCsv(env.RUNTIME_RUNNER_MODES || env.MBOS_RUNNER_MODE),
  browser_urls: {
    web: env.RUNTIME_BROWSER_WEB_BASE_URL ?? null,
    keycloak: env.RUNTIME_BROWSER_KEYCLOAK_BASE_URL ?? null,
  },
  host_local_urls: {
    api: env.RUNTIME_HOST_API_BASE_URL ?? null,
    web: env.RUNTIME_HOST_WEB_BASE_URL ?? null,
    keycloak: env.RUNTIME_HOST_KEYCLOAK_BASE_URL ?? null,
    proxy: env.MBOS_UNIVERSAL_PROXY_BASE_URL ?? null,
  },
  public_urls: {
    web: env.RUNTIME_PUBLIC_WEB_BASE_URL ?? null,
    api: env.RUNTIME_PUBLIC_API_BASE_URL ?? null,
    keycloak: env.RUNTIME_PUBLIC_KEYCLOAK_BASE_URL ?? null,
  },
  execution_urls: {
    websocket_base: env.AGENT_EXECUTION_WS_BASE_URL ?? null,
    sandbox_manager: env.SANDBOX_MANAGER_URL ?? null,
  },
  container_or_pod_urls: {
    websocket_callback: env.AGENT_EXECUTION_WS_BASE_URL ?? null,
    sandbox_callback: env.SANDBOX_MANAGER_URL ?? null,
  },
  ports: {
    api: env.INTEGRATION_API_PORT ?? env.PORT_API ?? env.API_PORT ?? null,
    web: env.INTEGRATION_WEB_PORT ?? env.PORT_WEB ?? env.WEB_PORT ?? null,
    keycloak: env.INTEGRATION_KEYCLOAK_PORT ?? env.KEYCLOAK_PORT ?? null,
    sandbox: env.INTERNAL_SANDBOX_MANAGER_PORT ?? env.SANDBOX_HOST_PORT ?? null,
  },
  image_refs: {
    runner: env.INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE ?? env.INTEGRATION_INTERNAL_AGENT_IMAGE ?? env.RUNNER_IMAGE ?? null,
    verify: env.VERIFY_RUNNER_IMAGE ?? null,
    sandbox_manager: env.SANDBOX_MANAGER_IMAGE ?? env.K8S_SANDBOX_MANAGER_IMAGE ?? null,
  },
  workspace_model: {
    runner_mode: env.MBOS_RUNNER_MODE ?? null,
    library_root_semantics: env.RUNTIME_LIBRARY_ROOT_SEMANTICS ?? 'file-library relative root',
    container_workspace_semantics: env.RUNTIME_CONTAINER_WORKSPACE_SEMANTICS ?? 'runner cwd inside bound workspace',
    host_workspace_root: env.HOME ? `${env.HOME}/ags-workspace` : null,
    container_workspace_root: env.RUNTIME_CONTAINER_WORKSPACE_ROOT ?? '/workspace',
  },
};
fs.writeFileSync(file, `${JSON.stringify(runtime, null, 2)}\n`);
NODE
}

gate_write_resolved_env() {
  local evidence_dir="$1"
  node - <<'NODE' "${evidence_dir}/resolved-env.json"
const fs = require('node:fs');
const [file] = process.argv.slice(2);
const env = process.env;
const keys = [
  'RUNTIME_LINE_ID',
  'RUNTIME_RUNNER_MODES',
  'INTEGRATION_API_PORT',
  'INTEGRATION_WEB_PORT',
  'INTEGRATION_BASE_URL',
  'INTEGRATION_API_BASE',
  'KEYCLOAK_BASE_URL',
  'KEYCLOAK_URL',
  'PUBLIC_KEYCLOAK_BASE_URL',
  'INTERNAL_KEYCLOAK_BASE_URL',
  'KEYCLOAK_ISSUER_URL',
  'MBOS_UNIVERSAL_PROXY_BASE_URL',
  'AGENT_EXECUTION_WS_BASE_URL',
  'SANDBOX_MANAGER_URL',
  'INTERNAL_AGENT_K8S_NAMESPACE',
  'INTEGRATION_INTERNAL_AGENT_IMAGE',
  'INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE',
  'RUNTIME_PUBLIC_WEB_BASE_URL',
  'RUNTIME_PUBLIC_API_BASE_URL',
  'RUNTIME_PUBLIC_KEYCLOAK_BASE_URL',
  'RUNTIME_HOST_WEB_BASE_URL',
  'RUNTIME_HOST_API_BASE_URL',
  'RUNTIME_HOST_KEYCLOAK_BASE_URL',
  'RUNTIME_BROWSER_WEB_BASE_URL',
  'RUNTIME_BROWSER_KEYCLOAK_BASE_URL',
  'RUNTIME_LIBRARY_ROOT_SEMANTICS',
  'RUNTIME_CONTAINER_WORKSPACE_SEMANTICS',
  'RUNTIME_CONTAINER_WORKSPACE_ROOT',
];
const data = Object.fromEntries(keys.map((key) => [key, env[key] ?? null]));
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
}

gate_record_preflight_check() {
  local evidence_dir="$1"
  local name="$2"
  local status="$3"
  local detail="${4:-}"
  node - <<'NODE' "${evidence_dir}/preflight.json" "${name}" "${status}" "${detail}"
const fs = require('node:fs');
const [file, name, status, detail] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
payload.checks = Array.isArray(payload.checks) ? payload.checks : [];
payload.checks.push({
  name,
  status,
  detail,
  recorded_at: new Date().toISOString(),
});
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

gate_resolve_verify_source_file() {
  local evidence_dir="$1"
  local line_label="$2"
  local release_root="$3"
  local workspace_root="$4"
  local relative_path="$5"

  case "${relative_path}" in
    ""|/*|../*|*/../*|..)
      gate_record_failure "${evidence_dir}" "scenario_assertion_failed" "scenario_gate_verify_assets" "invalid verify asset path ${relative_path}"
      return 1
      ;;
  esac

  local release_candidate="${release_root%/}/${relative_path}"
  local workspace_candidate="${workspace_root%/}/${relative_path}"
  if [[ -f "${release_candidate}" ]]; then
    printf '%s\n' "${release_candidate}"
    return 0
  fi
  if [[ -f "${workspace_candidate}" ]]; then
    printf '[%s] verify asset fallback to workspace copy: %s\n' "${line_label}" "${relative_path}" >&2
    gate_record_preflight_check "${evidence_dir}" "verify_asset_fallback" "warning" "${relative_path}"
    printf '%s\n' "${workspace_candidate}"
    return 0
  fi
  gate_record_failure "${evidence_dir}" "scenario_assertion_failed" "scenario_gate_verify_assets" "missing verify asset ${relative_path}"
  return 1
}

gate_record_failure() {
  local evidence_dir="$1"
  local classification="$2"
  local stage="$3"
  local message="${4:-}"
  mkdir -p "${evidence_dir}"
  node - <<'NODE' "${evidence_dir}/failure-classification.json" "${classification}" "${stage}" "${message}"
const fs = require('node:fs');
const [file, classification, stage, message] = process.argv.slice(2);
fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify({
  classification,
  stage,
  message,
  recorded_at: new Date().toISOString(),
}, null, 2)}\n`);
NODE
}

gate_record_success() {
  local evidence_dir="$1"
  local stage="${2:-complete}"
  gate_record_failure "${evidence_dir}" "none" "${stage}" "ok"
}

gate_record_workspace_access() {
  local evidence_dir="$1"
  local sample_kind="$2"
  local file_path="$3"
  node - <<'NODE' "${evidence_dir}/workspace-access.json" "${sample_kind}" "${file_path}"
const fs = require('node:fs');
const [targetFile, sampleKind, sampleFile] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
payload.samples = Array.isArray(payload.samples) ? payload.samples : [];
let sample = null;
try {
  sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
} catch {}
payload.samples.push({
  kind: sampleKind,
  captured_at: new Date().toISOString(),
  sample,
});
fs.writeFileSync(targetFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

gate_record_service_status() {
  local evidence_dir="$1"
  local service_name="$2"
  local status="$3"
  local detail="${4:-}"
  node - <<'NODE' "${evidence_dir}/service-status.json" "${service_name}" "${status}" "${detail}"
const fs = require('node:fs');
const [targetFile, serviceName, status, detail] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
payload.services = Array.isArray(payload.services) ? payload.services : [];
payload.services.push({
  service: serviceName,
  status,
  detail,
  recorded_at: new Date().toISOString(),
});
fs.writeFileSync(targetFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

gate_record_task_summary() {
  local evidence_dir="$1"
  local summary_json="$2"
  node - <<'NODE' "${evidence_dir}/task-summary.json" "${summary_json}"
const fs = require('node:fs');
const [targetFile, summaryJson] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
payload.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
let summary = {};
try {
  summary = JSON.parse(summaryJson);
} catch {}
payload.tasks.push({
  ...summary,
  recorded_at: new Date().toISOString(),
});
fs.writeFileSync(targetFile, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

gate_write_mount_tree() {
  local evidence_dir="$1"
  local root_path="$2"
  local output_file="${evidence_dir}/mount-tree.txt"
  mkdir -p "${evidence_dir}"
  {
    echo "# mount tree"
    echo "# root=${root_path}"
    if [[ -d "${root_path}" ]]; then
      find "${root_path}" -maxdepth 4 \( -type d -o -type f \) | sort
    else
      echo "missing:${root_path}"
    fi
  } > "${output_file}"
}


gate_wait_for_external_runner_connection() {
  local evidence_dir="$1"
  local container_name="$2"
  local timeout_seconds="${3:-60}"
  local started now runner_logs
  started="$(date +%s)"
  while true; do
    if docker inspect -f '{{.State.Running}}' "${container_name}" 2>/dev/null | grep -q true; then
      runner_logs="$(docker logs "${container_name}" 2>&1 || true)"
      if grep -q '\[agent-codex-runner\] connected' <<<"${runner_logs}"; then
        return 0
      fi
    fi
    now="$(date +%s)"
    if (( now - started >= timeout_seconds )); then
      gate_record_failure "${evidence_dir}" "runner_launch_failed" "infra_preflight_external_runner" "external-runner not connected"
      return 1
    fi
    sleep 2
  done
}


gate_wait_for_http() {
  local evidence_dir="$1"
  local url="$2"
  local timeout_seconds="$3"
  local classification="$4"
  local stage="$5"
  local accepted_codes="${6:-200,307,308}"
  local started last_code allowed_code
  started="$(date +%s)"
  while true; do
    last_code="$(curl -s -o /dev/null -w "%{http_code}" "${url}" || true)"
    IFS=',' read -r -a allowed <<< "${accepted_codes}"
    for allowed_code in "${allowed[@]}"; do
      if [[ "${last_code}" == "${allowed_code}" ]]; then
        return 0
      fi
    done
    if (( $(date +%s) - started >= timeout_seconds )); then
      gate_record_failure "${evidence_dir}" "${classification}" "${stage}" "unreachable ${url} (last status: ${last_code:-n/a})"
      return 1
    fi
    sleep 2
  done
}

gate_wait_for_tcp() {
  local evidence_dir="$1"
  local host="$2"
  local port="$3"
  local timeout_seconds="$4"
  local classification="$5"
  local stage="$6"
  local started
  started="$(date +%s)"
  while true; do
    if python3 - "$host" "$port" <<'PY_TCP'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
try:
    sock.connect((host, port))
except OSError:
    sys.exit(1)
else:
    sock.close()
    sys.exit(0)
PY_TCP
    then
      return 0
    fi
    if (( $(date +%s) - started >= timeout_seconds )); then
      gate_record_failure "${evidence_dir}" "${classification}" "${stage}" "tcp ${host}:${port} unavailable"
      return 1
    fi
    sleep 2
  done
}

gate_require_command() {
  local evidence_dir="$1"
  local command="$2"
  local classification="$3"
  local stage="$4"
  local message="$5"
  if ! eval "${command}"; then
    gate_record_failure "${evidence_dir}" "${classification}" "${stage}" "${message}"
    return 1
  fi
}


gate_run_auth_preflight() {
  local evidence_dir="$1"
  local keycloak_base_url="$2"
  local keycloak_realm="$3"
  local keycloak_client_id="$4"
  local username="$5"
  local password="$6"
  local api_profile_url="$7"
  local token_failure_message="${8:-failed to obtain integration token}"
  local missing_token_message="${9:-integration token missing access_token}"
  local profile_failure_message="${10:-authenticated profile endpoint unavailable}"

  local token_json
  token_json="$({
    curl -fsS "${keycloak_base_url}/realms/${keycloak_realm}/protocol/openid-connect/token" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode 'grant_type=password' \
      --data-urlencode "client_id=${keycloak_client_id}" \
      --data-urlencode "username=${username}" \
      --data-urlencode "password=${password}" \
      --data-urlencode 'scope=openid profile email'
  })" || {
    gate_record_failure "${evidence_dir}" "identity_bootstrap_failed" "auth_preflight_token" "${token_failure_message}"
    return 1
  }

  local access_token
  access_token="$(printf '%s' "${token_json}" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("access_token") or "").strip())')"
  if [[ -z "${access_token}" ]]; then
    gate_record_failure "${evidence_dir}" "identity_bootstrap_failed" "auth_preflight_token" "${missing_token_message}"
    return 1
  fi

  if ! curl -fsS "${api_profile_url}" -H "Authorization: Bearer ${access_token}" >/dev/null; then
    gate_record_failure "${evidence_dir}" "identity_bootstrap_failed" "auth_preflight_profile" "${profile_failure_message}"
    return 1
  fi

  gate_record_preflight_check "${evidence_dir}" "auth_preflight" "passed" "token issued and ${api_profile_url} accessible"
  printf '%s\n' "${access_token}"
}
