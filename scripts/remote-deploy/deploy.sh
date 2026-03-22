#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "remote-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  source "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  source "${ROOT_DIR}/scripts/lib/common.sh"
fi

ensure_dirs
if [[ ! -f "${RELEASE_ROOT}/env/site.env" ]]; then
  cp "${RELEASE_ROOT}/env/site.env.example" "${RELEASE_ROOT}/env/site.env"
fi

APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
SANDBOX_MANAGER_IMAGE="$(awk -F= '$1=="sandbox_manager_image"{print $2}' "${RELEASE_ROOT}/VERSION")"

image_tar_name() {
  printf '%s' "$1" | tr '/:@' '---'
}

write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}"

mkdir -p "${REMOTE_DEPLOY_ROOT}/releases"
ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

shopt -s nullglob
image_archives=("${RELEASE_ROOT}"/images/*.tar)
shopt -u nullglob
(( ${#image_archives[@]} > 0 )) || die "no image archives found under ${RELEASE_ROOT}/images"

for tar_file in "${image_archives[@]}"; do
  log "loading $(basename "${tar_file}")"
  docker load -i "${tar_file}" >/dev/null
done

if ! kind get clusters 2>/dev/null | grep -qx 'agentsmith'; then
  log "creating kind cluster"
  kind create cluster --config "${RELEASE_ROOT}/kind/config.yaml"
fi

for image in "${RUNNER_IMAGE}" "${SANDBOX_MANAGER_IMAGE}" "juicedata/juicefs-csi-driver:v0.31.2" "juicedata/csi-dashboard:v0.31.2" "juicedata/mount:ce-v1.3.1" "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0" "registry.k8s.io/sig-storage/csi-resizer:v1.9.0" "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0" "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"; do
  archive_path="${RELEASE_ROOT}/images/$(image_tar_name "${image}").tar"
  [[ -f "${archive_path}" ]] || die "missing kind image archive: ${archive_path}"
  kind load image-archive "${archive_path}" --name agentsmith >/dev/null
done

kubectl apply -f "${RELEASE_ROOT}/k8s/juicefs-csi.yaml" >/dev/null
kubectl rollout status statefulset/juicefs-csi-controller -n kube-system --timeout=240s >/dev/null
kubectl rollout status daemonset/juicefs-csi-node -n kube-system --timeout=240s >/dev/null

rm -f "${RELEASE_ROOT}/env/runtime-addresses.env"
bash "${RELEASE_SCRIPT_DIR}/resolve-runtime-addresses.sh"
bash "${RELEASE_SCRIPT_DIR}/render-env.sh"
load_release_env

docker_compose up -d postgres mongo redis minio minio-init keycloak api web
wait_http "${PUBLIC_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT}" 240
wait_http "${PUBLIC_WEB_BASE_URL}/api/public/workspaces" 240

KIND_GATEWAY="$(kind_gateway_ip)"

cat > "${REMOTE_DEPLOY_ROOT}/state/sandbox-manager.yaml" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: agentsmith-sandbox
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/status", "pods/exec", "persistentvolumeclaims", "secrets", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: agentsmith-sandbox
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sandbox-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: sandbox-manager-pv
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sandbox-manager-pv
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: agentsmith-sandbox
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: sandbox-manager-pv
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandbox-manager-config
  namespace: agentsmith-sandbox
data:
  manager-config.yaml: |
    version: 1
    server:
      httpPort: 8080
      requestIdHeader: X-Request-Id
      timeouts:
        readHeader: 5s
        read: 30s
        write: 60s
        idle: 120s
      maxHeaderBytes: 1048576
      metrics:
        enabled: true
        path: /metrics
      debug:
        configPath: /debug/config
        enablePprof: false
    auth:
      headerName: X-Service-Key
    kubernetes:
      qps: 50
      burst: 100
      requestTimeout: 15s
    sandbox:
      defaults:
        namespace: agentsmith-sandbox
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sandbox-manager
  template:
    metadata:
      labels:
        app: sandbox-manager
    spec:
      serviceAccountName: sandbox-manager
      containers:
        - name: manager
          image: ${SANDBOX_MANAGER_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: CONFIG_PATH
              value: /etc/sandbox-manager/manager-config.yaml
            - name: SERVICE_KEYS
              value: agentsmith-sandbox-key
            - name: K8S_NAMESPACE
              value: agentsmith-sandbox
            - name: JUICEFS_CSI_DRIVER
              value: csi.juicefs.com
            - name: JUICEFS_STORAGE_CAPACITY
              value: 1Pi
            - name: JUICEFS_STORAGE_CLASS_NAME
              value: ""
            - name: JUICEFS_MOUNT_OPTIONS
              value: writeback_cache
            - name: JUICEFS_MOUNT_IMAGE
              value: juicedata/mount:ce-v1.3.1
            - name: JUICEFS_STORAGE_ENDPOINT
              value: http://${KIND_GATEWAY}:19000
            - name: JUICEFS_STORAGE_ACCESS_KEY
              value: mbos
            - name: JUICEFS_STORAGE_SECRET_KEY
              value: mbos_dev_password
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
          volumeMounts:
            - name: config
              mountPath: /etc/sandbox-manager/manager-config.yaml
              subPath: manager-config.yaml
      volumes:
        - name: config
          configMap:
            name: sandbox-manager-config
---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
spec:
  selector:
    app: sandbox-manager
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-manager-nodeport
  namespace: agentsmith-sandbox
spec:
  type: NodePort
  selector:
    app: sandbox-manager
  ports:
    - name: http
      port: 80
      targetPort: 8080
      nodePort: 30080
EOF

kubectl apply -f "${REMOTE_DEPLOY_ROOT}/state/sandbox-manager.yaml" >/dev/null
kubectl rollout status deployment/sandbox-manager -n agentsmith-sandbox --timeout=240s >/dev/null
wait_http "http://localhost:${SANDBOX_HOST_PORT:-29080}/readyz" 120

docker_compose up -d api web
wait_tcp "127.0.0.1" "${API_PORT}" 240
wait_http "${PUBLIC_WEB_BASE_URL}/api/public/workspaces" 240

state_set release.phase deploy_completed
state_set release.id "${RELEASE_ID}"
state_set kind.cluster agentsmith
state_set sandbox.url "http://localhost:29080"
log "deploy ok"
