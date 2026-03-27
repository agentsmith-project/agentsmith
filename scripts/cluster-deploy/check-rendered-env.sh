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
grep -E '^NO_PROXY=.*(^|,)(postgres|minio)(,|$)' "${RELEASE_ROOT}/env/base.env" >/dev/null || {
  echo "[cluster-rendered-env] missing compose no_proxy entries" >&2
  exit 1
}
grep -Fxq 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.mbos.svc.cluster.local' "${RELEASE_ROOT}/env/internal.env" || {
  echo "[cluster-rendered-env] missing internal postgres external fqdn" >&2
  exit 1
}

python3 - <<'PY' "${ROOT_DIR}" "${TMP_ROOT}"
import os
import pathlib
import subprocess
import sys
root = pathlib.Path(sys.argv[1])
tmp = pathlib.Path(sys.argv[2])
release = tmp / "release-ip"
(release / "env").mkdir(parents=True, exist_ok=True)
source = root / "infra/deploy/cluster/env/site.env.example"
text = source.read_text(encoding="utf-8")
text = text.replace("SANDBOX_MANAGER_INGRESS_HOST=sandbox-manager.mbos.imotion.ai", "SANDBOX_MANAGER_INGRESS_HOST=")
text = text.replace("SANDBOX_MANAGER_PUBLIC_BASE_URL=https://sandbox-manager.mbos.imotion.ai", "SANDBOX_MANAGER_PUBLIC_BASE_URL=http://172.30.1.244")
text = text.replace("COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=", "COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=http://172.30.1.244")
(release / "env/site.env.example").write_text(text, encoding="utf-8")
(release / "env/site.env").write_text(text, encoding="utf-8")
subprocess.run(
    ["bash", str(root / "scripts/cluster-deploy/render-env.sh")],
    check=True,
    env={
        **os.environ,
        "ROOT_DIR": str(root),
        "RELEASE_ROOT": str(release),
        "DEPLOY_ROOT": str(tmp / "cluster-root-ip"),
    },
)
api_env = (release / "env/api.env").read_text(encoding="utf-8")
assert "SANDBOX_MANAGER_URL=http://172.30.1.244" in api_env, "missing IP sandbox manager url"
PY

echo "[cluster-rendered-env] ok"
