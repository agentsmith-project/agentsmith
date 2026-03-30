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

RESOLVED_RUNNER_HOST=host.docker.internal \
RESOLVED_KIND_GATEWAY_HOST=10.88.0.1 \
ALLOW_UNRESOLVED_KIND_GATEWAY=1 \
bash "${ROOT_DIR}/scripts/demo-deploy/render-env.sh" >/dev/null

release_check_require_files "missing_rendered_env" \
  "${RELEASE_ROOT}/env/base.env" \
  "${RELEASE_ROOT}/env/api.env" \
  "${RELEASE_ROOT}/env/web.env" \
  "${RELEASE_ROOT}/env/keycloak.env" \
  "${RELEASE_ROOT}/env/internal.env" \
  "${RELEASE_ROOT}/env/runner.env" \
  "${RELEASE_ROOT}/env/runtime-addresses.env"

release_check_require_exact_line "${RELEASE_ROOT}/env/web.env" 'NEXT_PUBLIC_API_BASE=http://localhost:20000' 'rendered_env_mismatch:web.env:NEXT_PUBLIC_API_BASE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'KEYCLOAK_ISSUER_URL=http://localhost:18080/realms/mbos' 'rendered_env_mismatch:api.env:KEYCLOAK_ISSUER_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/runner.env" 'MBOS_API_BASE=http://api:20000' 'rendered_env_mismatch:runner.env:MBOS_API_BASE'
release_check_require_exact_line "${RELEASE_ROOT}/env/keycloak.env" 'PUBLIC_KEYCLOAK_BASE_URL=http://localhost:18080' 'rendered_env_mismatch:keycloak.env:PUBLIC_KEYCLOAK_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL=http://host.docker.internal:20000' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_HTTP_BASE_URL=http://10.88.0.1:20000' 'rendered_env_mismatch:api.env:AGENT_EXECUTION_HTTP_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'MBOS_UNIVERSAL_PROXY_BASE_URL=http://universal-proxy:8080' 'rendered_env_mismatch:api.env:MBOS_UNIVERSAL_PROXY_BASE_URL'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_POSTGRES_HOST=localhost' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_HOST'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_POSTGRES_PORT=15432' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_PORT'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'FILE_LIBRARY_CLIENT_MINIO_ENDPOINT=http://localhost:19000' 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_MINIO_ENDPOINT'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=localhost' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE=15432' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://localhost:19000' 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(postgres|minio)(,|$)' 'rendered_env_mismatch:base.env:NO_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.agentsmith-sandbox.svc.cluster.local' 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE=5432' 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://minio-external.agentsmith-sandbox.svc.cluster.local:9000' 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE'

echo "[rendered-env] ok"
