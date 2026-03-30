#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

ensure_dirs
ensure_operator_site_env
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
require_supported_cluster_deploy_mode

for cmd in docker curl tar sha256sum python3; do
  require_cmd "${cmd}"
done
require_release_path "${RELEASE_ROOT}/deployment.manifest.json" "deployment.manifest.json"
require_release_path "${RELEASE_ROOT}/docs/contracts/cluster-deployment-spec-v1.md" "cluster deployment spec"
require_release_path "${RELEASE_ROOT}/docs/user-guides/cluster-admin-runbook.md" "cluster admin runbook"
require_release_path "${TOOLS_DIR}/kubectl" "bundled kubectl" "exe"
require_release_path "${RELEASE_ROOT}/compose/docker-compose.yml" "compose asset"
require_release_path "${RELEASE_ROOT}/images" "bundled image archives directory" "dir"
if [[ "$(cluster_deploy_mode)" == "full-auto" ]]; then
  require_release_path "${RELEASE_ROOT}/addons/ingress-nginx/upstream-deploy.yaml" "bundled ingress-nginx manifest for full-auto mode"
  require_release_path "${RELEASE_ROOT}/addons/juicefs-csi/upstream-manifest.yaml" "bundled juicefs-csi manifest for full-auto mode"
  kubectl kustomize --help >/dev/null 2>&1 || die "bundled kubectl must support kustomize for full-auto mode"
fi

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
ensure_operator_registry_env
load_registry_env
[[ -n "${REGISTRY_HOST:-}" && -n "${REGISTRY_PROJECT:-}" ]] \
  || die "registry.env must define REGISTRY_HOST and REGISTRY_PROJECT"

if [[ "$(cluster_deploy_mode)" == "full-auto" ]]; then
  ensure_operator_admin_kubeconfig
  load_admin_kubeconfig
else
  ensure_operator_kubeconfig
  load_kubeconfig
fi

kubectl version --request-timeout=10s >/dev/null

if [[ "$(cluster_deploy_mode)" == "semi-auto" ]]; then
  kubectl get namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" >/dev/null 2>&1 \
    || die "namespace ${INTERNAL_AGENT_K8S_NAMESPACE} must exist before cluster-deploy runs; complete the cluster admin runbook first"

  for resource in deployments services secrets configmaps ingresses.networking.k8s.io endpoints; do
    if [[ "$(kubectl auth can-i create "${resource}" -n "${INTERNAL_AGENT_K8S_NAMESPACE}")" != "yes" ]]; then
      die "current kubeconfig cannot create ${resource} in namespace ${INTERNAL_AGENT_K8S_NAMESPACE}"
    fi
  done
else
  [[ "${SANDBOX_MANAGER_INGRESS_CLASS_NAME}" == "nginx" ]] \
    || die "full-auto currently supports SANDBOX_MANAGER_INGRESS_CLASS_NAME=nginx only"
  for resource in namespaces clusterroles clusterrolebindings storageclasses ingressclasses validatingwebhookconfigurations csidrivers; do
    if [[ "$(kubectl auth can-i create "${resource}")" != "yes" ]]; then
      die "admin-kubeconfig cannot create ${resource}; full-auto requires cluster-scope installation privileges"
    fi
  done
  for resource in serviceaccounts roles rolebindings secrets; do
    if [[ "$(kubectl auth can-i create "${resource}" -n "${INTERNAL_AGENT_K8S_NAMESPACE}")" != "yes" ]]; then
      die "admin-kubeconfig cannot create ${resource} in namespace ${INTERNAL_AGENT_K8S_NAMESPACE}"
    fi
  done
  for resource in serviceaccounts roles rolebindings deployments services configmaps jobs; do
    if [[ "$(kubectl auth can-i create "${resource}" -n "${FULL_AUTO_INGRESS_NAMESPACE:-ingress-nginx}")" != "yes" ]]; then
      die "admin-kubeconfig cannot create ${resource} in namespace ${FULL_AUTO_INGRESS_NAMESPACE:-ingress-nginx}"
    fi
  done
  for resource in serviceaccounts deployments daemonsets statefulsets services configmaps; do
    if [[ "$(kubectl auth can-i create "${resource}" -n "${FULL_AUTO_JUICEFS_NAMESPACE:-juicefs-system}")" != "yes" ]]; then
      die "admin-kubeconfig cannot create ${resource} in namespace ${FULL_AUTO_JUICEFS_NAMESPACE:-juicefs-system}"
    fi
  done
fi

K8S_API_SERVER="$(awk '/^[[:space:]]*server:[[:space:]]*/ {print $2; exit}' "${KUBECONFIG}")"
[[ -n "${K8S_API_SERVER}" ]] || die "unable to resolve cluster api server from kubeconfig"
curl -ksS --connect-timeout 5 --max-time 10 "${K8S_API_SERVER}/version" >/dev/null \
  || die "target server cannot reach cluster api ${K8S_API_SERVER}; provide a kubeconfig reachable from the deploy host"

state_set release.phase prepare_completed
log "prepare ok"
