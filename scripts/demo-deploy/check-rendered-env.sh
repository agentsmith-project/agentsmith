#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/lib/release-check-common.sh"
release_check_init_tmp_root

DEMO_DEPLOY_ROOT="${TMP_ROOT}/deploy-root"
RELEASE_ROOT="${TMP_ROOT}/release"
export DEMO_DEPLOY_ROOT RELEASE_ROOT

mkdir -p "${RELEASE_ROOT}/env"
mkdir -p "${RELEASE_ROOT}/scripts/demo-deploy" "${RELEASE_ROOT}/scripts/lib"
cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${RELEASE_ROOT}/env/site.env"
cp "${ROOT_DIR}/scripts/demo-deploy/render-env.sh" "${RELEASE_ROOT}/scripts/demo-deploy/render-env.sh"
cp "${ROOT_DIR}/scripts/demo-deploy/resolve-runtime-addresses.sh" "${RELEASE_ROOT}/scripts/demo-deploy/resolve-runtime-addresses.sh"
cp "${ROOT_DIR}/scripts/demo-deploy/resolve-runtime-addresses.sh" "${RELEASE_ROOT}/scripts/resolve-runtime-addresses.sh"
cp "${ROOT_DIR}/scripts/lib/common.sh" "${RELEASE_ROOT}/scripts/lib/common.sh"
cp "${ROOT_DIR}/scripts/lib/deploy-common.sh" "${RELEASE_ROOT}/scripts/lib/deploy-common.sh"
cp "${ROOT_DIR}/scripts/lib/k8s-external-services.sh" "${RELEASE_ROOT}/scripts/lib/k8s-external-services.sh"
cp "${ROOT_DIR}/scripts/lib/preset-common.sh" "${RELEASE_ROOT}/scripts/lib/preset-common.sh"
mkdir -p "${RELEASE_ROOT}/infra/runtime"
cp "${ROOT_DIR}/infra/runtime/presets.env" "${RELEASE_ROOT}/infra/runtime/presets.env"

set_site_env_key() {
  local key="$1"
  local value="$2"
  python3 - <<'PY' "${RELEASE_ROOT}/env/site.env" "${key}" "${value}"
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text(encoding='utf-8').splitlines()
updated = []
replaced = False
for line in lines:
    if line.startswith(f'{key}='):
        updated.append(f'{key}={value}')
        replaced = True
    else:
        updated.append(line)
if not replaced:
    updated.append(f'{key}={value}')
path.write_text("\n".join(updated) + "\n", encoding='utf-8')
PY
}

set_runtime_proxy_config() {
  local runtime_proxy_mode="$1"
  local runtime_http_proxy="$2"
  local runtime_https_proxy="$3"
  local runtime_all_proxy="$4"
  local runtime_additional_no_proxy="${5:-}"

  set_site_env_key RUNTIME_PROXY_MODE "${runtime_proxy_mode}"
  set_site_env_key RUNTIME_HTTP_PROXY "${runtime_http_proxy}"
  set_site_env_key RUNTIME_HTTPS_PROXY "${runtime_https_proxy}"
  set_site_env_key RUNTIME_ALL_PROXY "${runtime_all_proxy}"
  set_site_env_key RUNTIME_ADDITIONAL_NO_PROXY "${runtime_additional_no_proxy}"
}

remove_site_env_keys() {
  python3 - <<'PY' "${RELEASE_ROOT}/env/site.env" "$@"
from pathlib import Path
import sys

path = Path(sys.argv[1])
remove = set(sys.argv[2:])
lines = path.read_text(encoding='utf-8').splitlines()
updated = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith('#') or '=' not in stripped:
        updated.append(line)
        continue
    key = stripped.split('=', 1)[0]
    if key in remove:
        continue
    updated.append(line)
path.write_text("\n".join(updated) + "\n", encoding='utf-8')
PY
}

run_render() {
  local mode="$1"
  local runner_host="runner.internal.test"
  set_site_env_key DEMO_DEPLOY_MODE "${mode}"
  set_site_env_key MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN fake-proxy-admin-token
  RESOLVED_RUNNER_HOST="${runner_host}" \
  RESOLVED_KIND_GATEWAY_HOST=10.88.0.1 \
  ALLOW_UNRESOLVED_KIND_GATEWAY=1 \
  bash "${ROOT_DIR}/scripts/demo-deploy/render-env.sh" >/dev/null
}

set_runtime_proxy_config sanitized "" "" "" ""
run_render full

release_check_require_files "missing_rendered_env" \
  "${RELEASE_ROOT}/env/base.env" \
  "${RELEASE_ROOT}/env/api.env" \
  "${RELEASE_ROOT}/env/web.env" \
  "${RELEASE_ROOT}/env/keycloak.env" \
  "${RELEASE_ROOT}/env/internal.env" \
  "${RELEASE_ROOT}/env/runner.env" \
  "${RELEASE_ROOT}/env/runtime-addresses.env"

release_check_require_exact_line "${RELEASE_ROOT}/env/site.env" 'SANDBOX_HOST_PORT=29180' 'rendered_env_mismatch:site.env:SANDBOX_HOST_PORT'

release_check_require_exact_line "${RELEASE_ROOT}/env/web.env" 'NEXT_PUBLIC_API_BASE=http://localhost:20000' 'rendered_env_mismatch:web.env:NEXT_PUBLIC_API_BASE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'KEYCLOAK_ISSUER_URL=http://localhost:18080/realms/mbos' 'rendered_env_mismatch:api.env:KEYCLOAK_ISSUER_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/runner.env" 'MBOS_API_BASE=http://api:20000' 'rendered_env_mismatch:runner.env:MBOS_API_BASE'
release_check_require_exact_line "${RELEASE_ROOT}/env/keycloak.env" 'PUBLIC_KEYCLOAK_BASE_URL=http://localhost:18080' 'rendered_env_mismatch:keycloak.env:PUBLIC_KEYCLOAK_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL=http://runner.internal.test:20000/api/v1' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_HTTP_BASE_URL=http://10.88.0.1:20000/api/v1' 'rendered_env_mismatch:api.env:AGENT_EXECUTION_HTTP_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'MBOS_UNIVERSAL_PROXY_BASE_URL=http://universal-proxy:8080' 'rendered_env_mismatch:api.env:MBOS_UNIVERSAL_PROXY_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_POSTGRES_HOST=localhost' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_HOST'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_POSTGRES_PORT=15432' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_PORT'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_MINIO_ENDPOINT=http://localhost:19000' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_MINIO_ENDPOINT'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY=http://minio:9000' 'rendered_env_mismatch:api.env:JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=localhost' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE=15432' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://localhost:19000' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE=runner.internal.test' 'rendered_env_mismatch:api.env:DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE=15432' 'rendered_env_mismatch:api.env:DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://runner.internal.test:19000' 'rendered_env_mismatch:api.env:DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(postgres|minio)(,|$)' 'rendered_env_mismatch:base.env:NO_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTP_PROXY=' 'rendered_env_mismatch:base.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTPS_PROXY=' 'rendered_env_mismatch:base.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'ALL_PROXY=' 'rendered_env_mismatch:base.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'http_proxy=' 'rendered_env_mismatch:base.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'https_proxy=' 'rendered_env_mismatch:base.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'all_proxy=' 'rendered_env_mismatch:base.env:all_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' 'rendered_env_mismatch:internal.env:MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' 'rendered_env_mismatch:internal.env:LLM_UNIVERSAL_PROXY_ADMIN_TOKEN'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_AUTH_MODE=client_provider_key' 'rendered_env_mismatch:internal.env:LLM_UNIVERSAL_PROXY_AUTH_MODE'
release_check_forbid_pattern "${RELEASE_ROOT}/env/internal.env" 'UNIVERSAL_PROXY_DATA_TOKEN=' 'rendered_env_unexpected:internal.env:UNIVERSAL_PROXY_DATA_TOKEN'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=' 'rendered_env_mismatch:internal.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=' 'rendered_env_mismatch:internal.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=' 'rendered_env_mismatch:internal.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=' 'rendered_env_mismatch:internal.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=' 'rendered_env_mismatch:internal.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=' 'rendered_env_mismatch:internal.env:all_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.agentsmith-sandbox.svc.cluster.local' 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE=5432' 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT=http://minio-external.agentsmith-sandbox.svc.cluster.local:9000' 'rendered_env_mismatch:internal.env:JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT'

set_runtime_proxy_config inherit "" "" "" "ops.internal,registry.internal"
HTTP_PROXY=http://inherit-http.proxy.internal:8080 \
HTTPS_PROXY=http://inherit-https.proxy.internal:8443 \
ALL_PROXY=socks5://inherit-all.proxy.internal:1080 \
NO_PROXY=corp.internal,shared.internal \
run_render full

release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTP_PROXY=http://inherit-http.proxy.internal:8080' 'rendered_env_mismatch:inherit:base.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTPS_PROXY=http://inherit-https.proxy.internal:8443' 'rendered_env_mismatch:inherit:base.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'ALL_PROXY=socks5://inherit-all.proxy.internal:1080' 'rendered_env_mismatch:inherit:base.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'http_proxy=http://inherit-http.proxy.internal:8080' 'rendered_env_mismatch:inherit:base.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'https_proxy=http://inherit-https.proxy.internal:8443' 'rendered_env_mismatch:inherit:base.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'all_proxy=socks5://inherit-all.proxy.internal:1080' 'rendered_env_mismatch:inherit:base.env:all_proxy'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(corp.internal|ops.internal)(,|$)' 'rendered_env_mismatch:inherit:base.env:NO_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=http://inherit-http.proxy.internal:8080' 'rendered_env_mismatch:inherit:internal.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=http://inherit-https.proxy.internal:8443' 'rendered_env_mismatch:inherit:internal.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=socks5://inherit-all.proxy.internal:1080' 'rendered_env_mismatch:inherit:internal.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=http://inherit-http.proxy.internal:8080' 'rendered_env_mismatch:inherit:internal.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=http://inherit-https.proxy.internal:8443' 'rendered_env_mismatch:inherit:internal.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=socks5://inherit-all.proxy.internal:1080' 'rendered_env_mismatch:inherit:internal.env:all_proxy'

set_runtime_proxy_config custom "http://custom-http.proxy.internal:8080" "http://custom-https.proxy.internal:8443" "socks5://custom-all.proxy.internal:1080" "custom.internal,packages.internal"
HTTP_PROXY=http://ambient-http.proxy.internal:8080 \
HTTPS_PROXY=http://ambient-https.proxy.internal:8443 \
ALL_PROXY=socks5://ambient-all.proxy.internal:1080 \
run_render full

release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTP_PROXY=http://custom-http.proxy.internal:8080' 'rendered_env_mismatch:custom:base.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTPS_PROXY=http://custom-https.proxy.internal:8443' 'rendered_env_mismatch:custom:base.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'ALL_PROXY=socks5://custom-all.proxy.internal:1080' 'rendered_env_mismatch:custom:base.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'http_proxy=http://custom-http.proxy.internal:8080' 'rendered_env_mismatch:custom:base.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'https_proxy=http://custom-https.proxy.internal:8443' 'rendered_env_mismatch:custom:base.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'all_proxy=socks5://custom-all.proxy.internal:1080' 'rendered_env_mismatch:custom:base.env:all_proxy'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(custom.internal|packages.internal)(,|$)' 'rendered_env_mismatch:custom:base.env:NO_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=http://custom-http.proxy.internal:8080' 'rendered_env_mismatch:custom:internal.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=http://custom-https.proxy.internal:8443' 'rendered_env_mismatch:custom:internal.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=socks5://custom-all.proxy.internal:1080' 'rendered_env_mismatch:custom:internal.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=http://custom-http.proxy.internal:8080' 'rendered_env_mismatch:custom:internal.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=http://custom-https.proxy.internal:8443' 'rendered_env_mismatch:custom:internal.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=socks5://custom-all.proxy.internal:1080' 'rendered_env_mismatch:custom:internal.env:all_proxy'
release_check_forbid_pattern "${RELEASE_ROOT}/env/base.env" 'ambient-http\.proxy\.internal' 'rendered_env_unexpected:custom:base.env:ambient_proxy'
release_check_forbid_pattern "${RELEASE_ROOT}/env/internal.env" 'ambient-http\.proxy\.internal' 'rendered_env_unexpected:custom:internal.env:ambient_proxy'

set_runtime_proxy_config sanitized "" "" "" ""
run_render simple

release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'DEMO_DEPLOY_MODE=simple' 'rendered_env_mismatch:base.env:DEMO_DEPLOY_MODE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL=http://runner.internal.test:20000/api/v1' 'rendered_env_mismatch:simple:api.env:EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE=runner.internal.test' 'rendered_env_mismatch:simple:api.env:DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://runner.internal.test:19000' 'rendered_env_mismatch:simple:api.env:DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE'
release_check_forbid_pattern "${RELEASE_ROOT}/env/api.env" '^SANDBOX_MANAGER_URL=' 'rendered_env_unexpected:simple:api.env:SANDBOX_MANAGER_URL'
release_check_forbid_pattern "${RELEASE_ROOT}/env/api.env" '^AGENT_EXECUTION_HTTP_BASE_URL=' 'rendered_env_unexpected:simple:api.env:AGENT_EXECUTION_HTTP_BASE_URL'
release_check_forbid_pattern "${RELEASE_ROOT}/env/api.env" '^AGENT_EXECUTION_WS_BASE_URL=' 'rendered_env_unexpected:simple:api.env:AGENT_EXECUTION_WS_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=' 'rendered_env_mismatch:simple:internal.env:HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=' 'rendered_env_mismatch:simple:internal.env:HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=' 'rendered_env_mismatch:simple:internal.env:ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=' 'rendered_env_mismatch:simple:internal.env:http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=' 'rendered_env_mismatch:simple:internal.env:https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=' 'rendered_env_mismatch:simple:internal.env:all_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' 'rendered_env_mismatch:simple:internal.env:MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' 'rendered_env_mismatch:simple:internal.env:LLM_UNIVERSAL_PROXY_ADMIN_TOKEN'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_AUTH_MODE=client_provider_key' 'rendered_env_mismatch:simple:internal.env:LLM_UNIVERSAL_PROXY_AUTH_MODE'
release_check_forbid_pattern "${RELEASE_ROOT}/env/internal.env" 'UNIVERSAL_PROXY_DATA_TOKEN=' 'rendered_env_unexpected:simple:internal.env:UNIVERSAL_PROXY_DATA_TOKEN'
release_check_require_pattern "${RELEASE_ROOT}/env/internal.env" 'internal sandbox runtime is disabled' 'rendered_env_mismatch:simple:internal.env'

remove_site_env_keys RUNTIME_PROXY_MODE RUNTIME_HTTP_PROXY RUNTIME_HTTPS_PROXY RUNTIME_ALL_PROXY RUNTIME_ADDITIONAL_NO_PROXY
set +e
missing_runtime_proxy_output="$(
  RUNTIME_PROXY_MODE=inherit \
  RUNTIME_HTTP_PROXY=http://ambient-http.proxy.internal:8080 \
  RUNTIME_HTTPS_PROXY=http://ambient-https.proxy.internal:8443 \
  RUNTIME_ALL_PROXY=socks5://ambient-all.proxy.internal:1080 \
  RUNTIME_ADDITIONAL_NO_PROXY=ambient.internal \
  RESOLVED_RUNNER_HOST=runner.internal.test \
  RESOLVED_KIND_GATEWAY_HOST=10.88.0.1 \
  ALLOW_UNRESOLVED_KIND_GATEWAY=1 \
  bash "${ROOT_DIR}/scripts/demo-deploy/render-env.sh" 2>&1
)"
missing_runtime_proxy_status=$?
set -e
if [[ "${missing_runtime_proxy_status}" == "0" ]]; then
  echo 'rendered_env_unexpected:missing_runtime_proxy_keys_succeeded' >&2
  exit 1
fi
printf '%s' "${missing_runtime_proxy_output}" | grep -F 'missing required site.env key: RUNTIME_PROXY_MODE' >/dev/null || {
  echo 'rendered_env_mismatch:missing_runtime_proxy_keys_error' >&2
  exit 1
}

echo "[rendered-env] ok"
