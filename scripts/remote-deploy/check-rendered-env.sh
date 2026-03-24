#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMP_ROOT}"' EXIT

REMOTE_DEPLOY_ROOT="${TMP_ROOT}/deploy-root"
RELEASE_ROOT="${TMP_ROOT}/release"
export REMOTE_DEPLOY_ROOT RELEASE_ROOT

mkdir -p "${RELEASE_ROOT}/env"
mkdir -p "${RELEASE_ROOT}/scripts/remote-deploy" "${RELEASE_ROOT}/scripts/lib"
cp "${ROOT_DIR}/infra/deploy/remote/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/remote/env/site.env.example" "${RELEASE_ROOT}/env/site.env"
cp "${ROOT_DIR}/scripts/remote-deploy/render-env.sh" "${RELEASE_ROOT}/scripts/remote-deploy/render-env.sh"
cp "${ROOT_DIR}/scripts/remote-deploy/resolve-runtime-addresses.sh" "${RELEASE_ROOT}/scripts/remote-deploy/resolve-runtime-addresses.sh"
cp "${ROOT_DIR}/scripts/remote-deploy/resolve-runtime-addresses.sh" "${RELEASE_ROOT}/scripts/resolve-runtime-addresses.sh"
cp "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh" "${RELEASE_ROOT}/scripts/lib/common.sh"

RESOLVED_RUNNER_HOST=host.docker.internal \
RESOLVED_KIND_GATEWAY_HOST=10.88.0.1 \
ALLOW_UNRESOLVED_KIND_GATEWAY=1 \
bash "${ROOT_DIR}/scripts/remote-deploy/render-env.sh" >/dev/null

for required_file in \
  "${RELEASE_ROOT}/env/base.env" \
  "${RELEASE_ROOT}/env/api.env" \
  "${RELEASE_ROOT}/env/web.env" \
  "${RELEASE_ROOT}/env/keycloak.env" \
  "${RELEASE_ROOT}/env/internal.env" \
  "${RELEASE_ROOT}/env/runner.env" \
  "${RELEASE_ROOT}/env/runtime-addresses.env"; do
  [[ -f "${required_file}" ]] || {
    echo "missing_rendered_env:${required_file}" >&2
    exit 1
  }
done

grep -Fxq 'NEXT_PUBLIC_API_BASE=http://localhost:20000' "${RELEASE_ROOT}/env/web.env" || {
  echo 'rendered_env_mismatch:web.env:NEXT_PUBLIC_API_BASE' >&2
  exit 1
}

grep -Fxq 'KEYCLOAK_ISSUER_URL=http://localhost:18080/realms/mbos' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:KEYCLOAK_ISSUER_URL' >&2
  exit 1
}

grep -Fxq 'MBOS_API_BASE=http://api:20000' "${RELEASE_ROOT}/env/runner.env" || {
  echo 'rendered_env_mismatch:runner.env:MBOS_API_BASE' >&2
  exit 1
}

grep -Fxq 'PUBLIC_KEYCLOAK_BASE_URL=http://localhost:18080' "${RELEASE_ROOT}/env/keycloak.env" || {
  echo 'rendered_env_mismatch:keycloak.env:PUBLIC_KEYCLOAK_BASE_URL' >&2
  exit 1
}

grep -Fxq 'EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL=http://host.docker.internal:20000' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL' >&2
  exit 1
}

grep -Fxq 'AGENT_EXECUTION_HTTP_BASE_URL=http://10.88.0.1:20000' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:AGENT_EXECUTION_HTTP_BASE_URL' >&2
  exit 1
}

grep -Fxq 'MBOS_UNIVERSAL_PROXY_BASE_URL=http://universal-proxy:8080' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:MBOS_UNIVERSAL_PROXY_BASE_URL' >&2
  exit 1
}

grep -Fxq 'FILE_LIBRARY_CLIENT_POSTGRES_HOST=localhost' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_HOST' >&2
  exit 1
}

grep -Fxq 'FILE_LIBRARY_CLIENT_POSTGRES_PORT=15432' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_POSTGRES_PORT' >&2
  exit 1
}

grep -Fxq 'FILE_LIBRARY_CLIENT_MINIO_ENDPOINT=http://localhost:19000' "${RELEASE_ROOT}/env/api.env" || {
  echo 'rendered_env_mismatch:api.env:FILE_LIBRARY_CLIENT_MINIO_ENDPOINT' >&2
  exit 1
}

grep -Fxq 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=10.88.0.1' "${RELEASE_ROOT}/env/internal.env" || {
  echo 'rendered_env_mismatch:internal.env:INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE' >&2
  exit 1
}

echo "[rendered-env] ok"
