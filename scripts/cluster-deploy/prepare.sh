#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_registry_env
ensure_operator_kubeconfig
load_registry_env
load_kubeconfig

for cmd in docker curl tar sha256sum python3; do
  require_cmd "${cmd}"
done
[[ -f "${RELEASE_ROOT}/deployment.manifest.json" ]] || die "missing deployment.manifest.json in ${RELEASE_ROOT}"
[[ -f "${RELEASE_ROOT}/docs/contracts/cluster-deployment-spec-v1.md" ]] || die "missing cluster deployment spec in ${RELEASE_ROOT}"
[[ -x "${TOOLS_DIR}/kubectl" ]] || die "missing bundled kubectl at ${TOOLS_DIR}/kubectl"
[[ -f "${RELEASE_ROOT}/compose/docker-compose.yml" ]] || die "missing compose asset in ${RELEASE_ROOT}"

python3 - <<'PY' "${RELEASE_ROOT}/deployment.manifest.json" "${RELEASE_ROOT}"
import json
import pathlib
import sys
manifest_path = pathlib.Path(sys.argv[1])
release_root = pathlib.Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for relative in manifest.get("bundle_files", []):
    if not (release_root / relative).exists():
        raise SystemExit(f"missing_release_asset:{relative}")
PY

load_release_env
kubectl version --request-timeout=10s >/dev/null
[[ -n "${REGISTRY_HOST:-}" && -n "${REGISTRY_PROJECT:-}" && -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] \
  || die "registry.env must define REGISTRY_HOST, REGISTRY_PROJECT, REGISTRY_USERNAME, REGISTRY_PASSWORD"

docker login "${REGISTRY_HOST}" -u "${REGISTRY_USERNAME}" -p "${REGISTRY_PASSWORD}" >/dev/null 2>&1 \
  || die "registry login failed for ${REGISTRY_HOST}"

ingress_count="$(kubectl get ingressclass -o name 2>/dev/null | wc -l | tr -d ' ')"
[[ "${ingress_count}" -ge 1 ]] || die "no ingressclass found in target cluster"

node_count="$(kubectl get nodes -l node=mbos --no-headers 2>/dev/null | wc -l | tr -d ' ')"
[[ "${node_count}" -ge 1 ]] || die "no node found with label node=mbos"
taint_count="$(kubectl get nodes -l node=mbos -o json | python3 -c 'import json,sys; data=json.load(sys.stdin); c=0
for item in data.get("items", []):
  for taint in item.get("spec", {}).get("taints", []) or []:
    if taint.get("key") == "mbos" and taint.get("effect") == "NoExecute":
      c += 1
print(c)')"
[[ "${taint_count}" -ge 1 ]] || die "expected taint mbos:NoExecute on node=mbos"

state_set release.phase prepare_completed
log "prepare ok"
