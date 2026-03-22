#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMP_ROOT}"' EXIT

REMOTE_DEPLOY_ROOT="${TMP_ROOT}/deploy-root"
RELEASE_ROOT="${TMP_ROOT}/release"
export REMOTE_DEPLOY_ROOT RELEASE_ROOT

mkdir -p "${RELEASE_ROOT}/env"
cp "${ROOT_DIR}/infra/deploy/remote/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/remote/env/site.env.example" "${RELEASE_ROOT}/env/site.env"

bash "${ROOT_DIR}/scripts/remote-deploy/render-env.sh" >/dev/null

for required_file in \
  "${RELEASE_ROOT}/env/base.env" \
  "${RELEASE_ROOT}/env/api.env" \
  "${RELEASE_ROOT}/env/web.env" \
  "${RELEASE_ROOT}/env/keycloak.env" \
  "${RELEASE_ROOT}/env/internal.env" \
  "${RELEASE_ROOT}/env/runner.env"; do
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

echo "[rendered-env] ok"
