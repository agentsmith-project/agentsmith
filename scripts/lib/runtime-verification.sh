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

gate_evidence_init() {
  local evidence_dir="$1"
  local line_kind="$2"
  mkdir -p "${evidence_dir}" "${evidence_dir}/logs" "${evidence_dir}/runner" "${evidence_dir}/playwright"
  printf '{\n  "line_kind": "%s",\n  "checks": []\n}\n' "${line_kind}" > "${evidence_dir}/preflight.json"
  printf '{\n  "classification": "pending",\n  "stage": "bootstrap",\n  "message": ""\n}\n' > "${evidence_dir}/failure-classification.json"
}

gate_write_runtime_descriptor() {
  local evidence_dir="$1"
  local line_kind="$2"
  node - <<'NODE' "${evidence_dir}/runtime.json" "${line_kind}"
const fs = require('node:fs');
const [file, lineKind] = process.argv.slice(2);
const env = process.env;
const runtime = {
  line_kind: lineKind,
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
  ports: {
    api: env.INTEGRATION_API_PORT ?? env.PORT_API ?? env.API_PORT ?? null,
    web: env.INTEGRATION_WEB_PORT ?? env.PORT_WEB ?? env.WEB_PORT ?? null,
    keycloak: env.INTEGRATION_KEYCLOAK_PORT ?? env.KEYCLOAK_PORT ?? null,
    sandbox: env.INTERNAL_SANDBOX_MANAGER_PORT ?? env.SANDBOX_HOST_PORT ?? null,
  },
  images: {
    runner: env.INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE ?? env.INTEGRATION_INTERNAL_AGENT_IMAGE ?? env.RUNNER_IMAGE ?? null,
    verify: env.VERIFY_RUNNER_IMAGE ?? null,
    sandbox_manager: env.SANDBOX_MANAGER_IMAGE ?? env.K8S_SANDBOX_MANAGER_IMAGE ?? null,
  },
  workspace: {
    runner_mode: env.MBOS_RUNNER_MODE ?? null,
    host_workspace_root: env.HOME ? `${env.HOME}/ags-workspace` : null,
    container_workspace_root: '/workspace',
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

gate_record_failure() {
  local evidence_dir="$1"
  local classification="$2"
  local stage="$3"
  local message="${4:-}"
  node - <<'NODE' "${evidence_dir}/failure-classification.json" "${classification}" "${stage}" "${message}"
const fs = require('node:fs');
const [file, classification, stage, message] = process.argv.slice(2);
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
