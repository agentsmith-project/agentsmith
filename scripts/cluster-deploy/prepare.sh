#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_kubeconfig
ensure_operator_manager_kubeconfig
load_kubeconfig
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a

for cmd in docker curl tar sha256sum python3; do
  require_cmd "${cmd}"
done
[[ -f "${RELEASE_ROOT}/deployment.manifest.json" ]] || die "missing deployment.manifest.json in ${RELEASE_ROOT}"
[[ -f "${RELEASE_ROOT}/docs/contracts/cluster-deployment-spec-v1.md" ]] || die "missing cluster deployment spec in ${RELEASE_ROOT}"
[[ -f "${RELEASE_ROOT}/docs/user-guides/cluster-admin-runbook.md" ]] || die "missing cluster admin runbook in ${RELEASE_ROOT}"
[[ -x "${TOOLS_DIR}/kubectl" ]] || die "missing bundled kubectl at ${TOOLS_DIR}/kubectl"
[[ -f "${RELEASE_ROOT}/compose/docker-compose.yml" ]] || die "missing compose asset in ${RELEASE_ROOT}"
[[ -d "${RELEASE_ROOT}/images" ]] || die "missing bundled image archives directory at ${RELEASE_ROOT}/images"
[[ -f "${SHARED_MANAGER_KUBECONFIG}" ]] || die "missing shared manager-kubeconfig at ${SHARED_MANAGER_KUBECONFIG}"

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
kubectl version --request-timeout=10s >/dev/null
ensure_operator_registry_env
load_registry_env
[[ -n "${REGISTRY_HOST:-}" && -n "${REGISTRY_PROJECT:-}" && -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] \
  || die "registry.env must define REGISTRY_HOST, REGISTRY_PROJECT, REGISTRY_USERNAME, REGISTRY_PASSWORD"

kubectl get namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" >/dev/null 2>&1 \
  || die "namespace ${INTERNAL_AGENT_K8S_NAMESPACE} must exist before cluster-deploy runs; complete the cluster admin runbook first"

for resource in deployments services secrets configmaps ingresses.networking.k8s.io; do
  if [[ "$(kubectl auth can-i create "${resource}" -n "${INTERNAL_AGENT_K8S_NAMESPACE}")" != "yes" ]]; then
    die "current kubeconfig cannot create ${resource} in namespace ${INTERNAL_AGENT_K8S_NAMESPACE}"
  fi
done

for resource in endpoints; do
  if [[ "$(kubectl auth can-i create "${resource}" -n "${INTERNAL_AGENT_K8S_NAMESPACE}")" != "yes" ]]; then
    die "current kubeconfig cannot create ${resource} in namespace ${INTERNAL_AGENT_K8S_NAMESPACE}"
  fi
done

K8S_API_SERVER="$(awk '/^[[:space:]]*server:[[:space:]]*/ {print $2; exit}' "${KUBECONFIG}")"
[[ -n "${K8S_API_SERVER}" ]] || die "unable to resolve cluster api server from kubeconfig"
curl -ksS --connect-timeout 5 --max-time 10 "${K8S_API_SERVER}/version" >/dev/null \
  || die "target server cannot reach cluster api ${K8S_API_SERVER}; provide a kubeconfig reachable from the deploy host"

[[ -n "${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" ]] \
  || die "INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME must be set; confirm the preinstalled storage class in the cluster admin runbook before running cluster-deploy"

for check in \
  "create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "create persistentvolumeclaims -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "create pods -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "get persistentvolumes" \
  "create persistentvolumes" \
  "update persistentvolumes" \
  "delete persistentvolumes"; do
  if [[ "$(KUBECONFIG="${SHARED_MANAGER_KUBECONFIG}" kubectl auth can-i ${check} 2>/dev/null || true)" != "yes" ]]; then
    die "manager-kubeconfig is missing required permission: ${check}"
  fi
done

state_set release.phase prepare_completed
log "prepare ok"
