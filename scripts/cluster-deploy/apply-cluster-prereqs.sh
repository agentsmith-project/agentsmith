#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_admin_kubeconfig
ensure_operator_registry_env
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
require_supported_cluster_deploy_mode
[[ "$(cluster_deploy_mode)" == "full-auto" ]] || die "apply-cluster-prereqs is only supported when CLUSTER_DEPLOY_MODE=full-auto"
if [[ ! -x "${ADMIN_HANDOFF_DIR}/scripts/final-verification.sh" ]]; then
  bash "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
fi

load_admin_kubeconfig
load_registry_env
require_version_images

FULL_AUTO_INGRESS_NAMESPACE="${FULL_AUTO_INGRESS_NAMESPACE:-ingress-nginx}"
FULL_AUTO_JUICEFS_NAMESPACE="${FULL_AUTO_JUICEFS_NAMESPACE:-juicefs-system}"
[[ -n "${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" ]] || die "INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME must be set for full-auto mode"

PREREQ_DIR="${STATE_DIR}/full-auto-prereqs"
rm -rf "${PREREQ_DIR}"
mkdir -p "${PREREQ_DIR}"
REGISTRY_SECRET_NAME="agentsmith-registry"

cat > "${PREREQ_DIR}/namespace.yaml" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${FULL_AUTO_INGRESS_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${FULL_AUTO_JUICEFS_NAMESPACE}
EOF

cat > "${PREREQ_DIR}/agentsmith-prereqs.yaml" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: juicefs-csi-secret
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
type: Opaque
stringData:
  name: mbos-jfs
  metaurl: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${K8S_EXTERNAL_POSTGRES_HOST}:${K8S_EXTERNAL_POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable
  storage: s3
  bucket: http://${K8S_EXTERNAL_MINIO_HOST}:${K8S_EXTERNAL_MINIO_PORT}/${MINIO_BUCKET}
  access-key: ${MINIO_ROOT_USER}
  secret-key: ${MINIO_ROOT_PASSWORD}
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME}
provisioner: ${INTERNAL_AGENT_JUICEFS_CSI_DRIVER}
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  csi.storage.k8s.io/provisioner-secret-name: juicefs-csi-secret
  csi.storage.k8s.io/provisioner-secret-namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
  csi.storage.k8s.io/controller-expand-secret-name: juicefs-csi-secret
  csi.storage.k8s.io/controller-expand-secret-namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
  csi.storage.k8s.io/node-stage-secret-name: juicefs-csi-secret
  csi.storage.k8s.io/node-stage-secret-namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agentsmith-deploy
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: agentsmith-deploy
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
rules:
  - apiGroups: [""]
    resources: ["services", "endpoints", "configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agentsmith-deploy
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: agentsmith-deploy
    namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: agentsmith-deploy
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agentsmith-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: agentsmith-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
rules:
  - apiGroups: [""]
    resources: ["secrets", "persistentvolumeclaims", "pods", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agentsmith-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: agentsmith-manager
    namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: agentsmith-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: agentsmith-manager-pv
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: agentsmith-manager-pv
subjects:
  - kind: ServiceAccount
    name: agentsmith-manager
    namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: agentsmith-manager-pv
EOF

python3 - <<'PY' "${RELEASE_ROOT}/addons/juicefs-csi/upstream-manifest.yaml" "${PREREQ_DIR}/juicefs-csi.yaml" "${FULL_AUTO_JUICEFS_NAMESPACE}" "${JUICEFS_CSI_DASHBOARD_IMAGE}" "${JUICEFS_CSI_DRIVER_IMAGE}" "${JUICEFS_CSI_PROVISIONER_IMAGE}" "${JUICEFS_CSI_RESIZER_IMAGE}" "${JUICEFS_CSI_LIVENESSPROBE_IMAGE}" "${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text(encoding="utf-8")
dst = Path(sys.argv[2])
namespace = sys.argv[3]
replacements = {
    "namespace: kube-system": f"namespace: {namespace}",
    "image: juicedata/csi-dashboard:v0.31.3": f"image: {sys.argv[4]}",
    "image: juicedata/juicefs-csi-driver:v0.31.3": f"image: {sys.argv[5]}",
    "image: registry.k8s.io/sig-storage/csi-provisioner:v3.6.0": f"image: {sys.argv[6]}",
    "image: registry.k8s.io/sig-storage/csi-resizer:v1.9.0": f"image: {sys.argv[7]}",
    "image: registry.k8s.io/sig-storage/livenessprobe:v2.11.0": f"image: {sys.argv[8]}",
    "image: registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0": f"image: {sys.argv[9]}",
}
for old, new in replacements.items():
    src = src.replace(old, new)
dst.write_text(src, encoding="utf-8")
PY

python3 - <<'PY' "${RELEASE_ROOT}/addons/ingress-nginx/upstream-deploy.yaml" "${PREREQ_DIR}/ingress-nginx.yaml" "${FULL_AUTO_INGRESS_NAMESPACE}" "${INGRESS_NGINX_CONTROLLER_IMAGE}" "${INGRESS_NGINX_CERTGEN_IMAGE}"
from pathlib import Path
import sys

lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
dst = Path(sys.argv[2])
namespace = sys.argv[3]
controller_image = sys.argv[4]
certgen_image = sys.argv[5]

out = []
current_kind = None
for line in lines:
    stripped = line.strip()
    if stripped.startswith("kind: "):
      current_kind = stripped.split(":", 1)[1].strip()
    if current_kind == "Namespace" and stripped == "name: ingress-nginx":
      indent = line[: len(line) - len(line.lstrip())]
      line = f"{indent}name: {namespace}"
    if stripped == "namespace: ingress-nginx":
      indent = line[: len(line) - len(line.lstrip())]
      line = f"{indent}namespace: {namespace}"
    line = line.replace(
      "image: registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:594ceea76b01c592858f803f9ff4d2cb40542cae2060410b2c95f75907d659e1",
      f"image: {controller_image}",
    )
    line = line.replace(
      "image: registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:01038e7de14b78d702d2849c3aad72fd25903c4765af63cf16aa3398f5d5f2dd",
      f"image: {certgen_image}",
    )
    out.append(line)
dst.write_text("\n".join(out) + "\n", encoding="utf-8")
PY

KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f "${PREREQ_DIR}/namespace.yaml" >/dev/null

ensure_registry_secret() {
  local namespace="$1"
  KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl create secret docker-registry "${REGISTRY_SECRET_NAME}" \
    --namespace "${namespace}" \
    --docker-server "${REGISTRY_HOST}" \
    --docker-username "${REGISTRY_USERNAME}" \
    --docker-password "${REGISTRY_PASSWORD}" \
    --dry-run=client -o yaml \
    | KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f - >/dev/null
}

patch_serviceaccount_pull_secret() {
  local namespace="$1"
  local service_account="$2"
  KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl patch serviceaccount "${service_account}" \
    -n "${namespace}" \
    --type merge \
    -p "{\"imagePullSecrets\":[{\"name\":\"${REGISTRY_SECRET_NAME}\"}]}" >/dev/null
}

ensure_registry_secret "${FULL_AUTO_INGRESS_NAMESPACE}"
ensure_registry_secret "${FULL_AUTO_JUICEFS_NAMESPACE}"
ensure_registry_secret "${INTERNAL_AGENT_K8S_NAMESPACE}"

KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl delete job/ingress-nginx-admission-create -n "${FULL_AUTO_INGRESS_NAMESPACE}" --ignore-not-found >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl delete job/ingress-nginx-admission-patch -n "${FULL_AUTO_INGRESS_NAMESPACE}" --ignore-not-found >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f "${PREREQ_DIR}/ingress-nginx.yaml" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f "${PREREQ_DIR}/juicefs-csi.yaml" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f "${PREREQ_DIR}/agentsmith-prereqs.yaml" >/dev/null

patch_serviceaccount_pull_secret "${FULL_AUTO_INGRESS_NAMESPACE}" "ingress-nginx"
patch_serviceaccount_pull_secret "${FULL_AUTO_INGRESS_NAMESPACE}" "ingress-nginx-admission"
patch_serviceaccount_pull_secret "${FULL_AUTO_JUICEFS_NAMESPACE}" "juicefs-csi-controller-sa"
patch_serviceaccount_pull_secret "${FULL_AUTO_JUICEFS_NAMESPACE}" "juicefs-csi-dashboard-sa"
patch_serviceaccount_pull_secret "${FULL_AUTO_JUICEFS_NAMESPACE}" "juicefs-csi-node-sa"

KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl delete pod -n "${FULL_AUTO_INGRESS_NAMESPACE}" -l app.kubernetes.io/component=controller --ignore-not-found >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl delete job/ingress-nginx-admission-create -n "${FULL_AUTO_INGRESS_NAMESPACE}" --ignore-not-found >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl delete job/ingress-nginx-admission-patch -n "${FULL_AUTO_INGRESS_NAMESPACE}" --ignore-not-found >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f "${PREREQ_DIR}/ingress-nginx.yaml" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout restart deployment/ingress-nginx-controller -n "${FULL_AUTO_INGRESS_NAMESPACE}" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout restart statefulset/juicefs-csi-controller -n "${FULL_AUTO_JUICEFS_NAMESPACE}" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout restart daemonset/juicefs-csi-node -n "${FULL_AUTO_JUICEFS_NAMESPACE}" >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout restart deployment/juicefs-csi-dashboard -n "${FULL_AUTO_JUICEFS_NAMESPACE}" >/dev/null

KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout status deployment/ingress-nginx-controller -n "${FULL_AUTO_INGRESS_NAMESPACE}" --timeout=240s >/dev/null
if KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl get job/ingress-nginx-admission-create -n "${FULL_AUTO_INGRESS_NAMESPACE}" >/dev/null 2>&1; then
  KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl wait --for=condition=complete job/ingress-nginx-admission-create -n "${FULL_AUTO_INGRESS_NAMESPACE}" --timeout=240s >/dev/null
fi
if KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl get job/ingress-nginx-admission-patch -n "${FULL_AUTO_INGRESS_NAMESPACE}" >/dev/null 2>&1; then
  KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl wait --for=condition=complete job/ingress-nginx-admission-patch -n "${FULL_AUTO_INGRESS_NAMESPACE}" --timeout=240s >/dev/null
fi
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout status statefulset/juicefs-csi-controller -n "${FULL_AUTO_JUICEFS_NAMESPACE}" --timeout=240s >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout status daemonset/juicefs-csi-node -n "${FULL_AUTO_JUICEFS_NAMESPACE}" --timeout=240s >/dev/null
KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl rollout status deployment/juicefs-csi-dashboard -n "${FULL_AUTO_JUICEFS_NAMESPACE}" --timeout=240s >/dev/null

build_cluster_kubeconfig_from_admin "agentsmith-deploy" "${INTERNAL_AGENT_K8S_NAMESPACE}" "${SHARED_KUBECONFIG}"
build_cluster_kubeconfig_from_admin "agentsmith-manager" "${INTERNAL_AGENT_K8S_NAMESPACE}" "${SHARED_MANAGER_KUBECONFIG}"
cp "${SHARED_KUBECONFIG}" "${RELEASE_ROOT}/env/kubeconfig"
cp "${SHARED_MANAGER_KUBECONFIG}" "${RELEASE_ROOT}/env/manager-kubeconfig"

bash "${ADMIN_HANDOFF_DIR}/scripts/final-verification.sh" >/dev/null

cat > "${SHARED_ADMIN_READY_ENV}" <<EOF
ADMIN_READY=1
ADMIN_CHECKED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ADMIN_MODE=full-auto
EOF

state_set release.phase apply_cluster_prereqs_completed
state_set admin.ready 1
log "apply-cluster-prereqs ok"
