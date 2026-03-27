#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMP_ROOT}"' EXIT
RELEASE_ROOT="${TMP_ROOT}/release"
mkdir -p "${RELEASE_ROOT}/env"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env"

DEPLOY_ROOT="${TMP_ROOT}/cluster-root" RELEASE_ROOT="${RELEASE_ROOT}" \
  bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"

grep -Fxq 'SANDBOX_MANAGER_URL=https://sandbox-manager.mbos.imotion.ai' "${RELEASE_ROOT}/env/api.env" || {
  echo "[cluster-rendered-env] missing sandbox manager url" >&2
  exit 1
}
grep -Fxq 'AGENT_EXECUTION_HTTP_BASE_URL=https://mbos.imotion.ai/api' "${RELEASE_ROOT}/env/api.env" || {
  echo "[cluster-rendered-env] missing internal agent execution http base" >&2
  exit 1
}
grep -Fxq 'AGENT_EXECUTION_WS_BASE_URL=wss://mbos.imotion.ai/api' "${RELEASE_ROOT}/env/api.env" || {
  echo "[cluster-rendered-env] missing internal agent execution websocket base" >&2
  exit 1
}
grep -Fxq 'INTERNAL_AGENT_DEFAULT_CPU_REQUEST=1' "${RELEASE_ROOT}/env/internal.env" || {
  echo "[cluster-rendered-env] missing internal cpu request default" >&2
  exit 1
}
grep -Fxq 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.mbos.svc.cluster.local' "${RELEASE_ROOT}/env/internal.env" || {
  echo "[cluster-rendered-env] missing internal postgres external fqdn" >&2
  exit 1
}

echo "[cluster-rendered-env] ok"
