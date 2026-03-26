#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_registry_env
ensure_operator_kubeconfig
load_kubeconfig
load_release_env

bash "${ROOT_DIR}/scripts/cluster-deploy/build-images.sh"

APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
SANDBOX_MANAGER_IMAGE="$(awk -F= '$1=="sandbox_manager_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"

write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
mkdir -p "${CLUSTER_DEPLOY_ROOT}/releases"
ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

docker_compose pull
docker_compose up -d postgres mongo redis minio minio-init keycloak universal-proxy api web external-runner

HOST_LOCAL_WEB_BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}"
HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT}" 240
wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240

kubectl create namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

kubectl create secret docker-registry agentsmith-registry \
  --namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" \
  --docker-server="${REGISTRY_HOST}" \
  --docker-username="${REGISTRY_USERNAME}" \
  --docker-password="${REGISTRY_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

EXTERNAL_DEPS_MANIFEST="${STATE_DIR}/cluster-external-services.yaml"
render_k8s_external_dependency_services \
  "${EXTERNAL_DEPS_MANIFEST}" \
  "${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "${K8S_EXTERNAL_POSTGRES_HOST}" \
  "${K8S_EXTERNAL_POSTGRES_PORT}" \
  "${K8S_EXTERNAL_MINIO_HOST}" \
  "${K8S_EXTERNAL_MINIO_PORT}"
kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null

kubectl apply -f "${RELEASE_ROOT}/k8s/juicefs-csi.yaml" >/dev/null

MANAGER_MANIFEST="${STATE_DIR}/sandbox-manager-cluster.yaml"
NODE_SELECTOR_YAML="$(python3 -c 'import json,sys; data=json.loads(sys.argv[1]); print("\n".join([f"        {k}: {v}" for k,v in data.items()]))' "${SANDBOX_MANAGER_NODE_SELECTOR_JSON}")"
TOLERATIONS_YAML="$(python3 -c 'import json,sys; data=json.loads(sys.argv[1]); lines=[]; 
for item in data:
 lines.append("        - key: " + item.get("key",""))
 op=item.get("operator")
 if op: lines.append("          operator: " + op)
 val=item.get("value")
 if val is not None: lines.append("          value: " + str(val))
 eff=item.get("effect")
 if eff: lines.append("          effect: " + eff)
 sec=item.get("tolerationSeconds")
 if sec is not None: lines.append("          tolerationSeconds: " + str(sec))
print("\n".join(lines))' "${SANDBOX_MANAGER_TOLERATIONS_JSON}")"
cat > "${MANAGER_MANIFEST}" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sandbox-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sandbox-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/status", "pods/exec", "persistentvolumeclaims", "secrets", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sandbox-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sandbox-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${INTERNAL_AGENT_K8S_NAMESPACE}-sandbox-manager-pv
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${INTERNAL_AGENT_K8S_NAMESPACE}-sandbox-manager-pv
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${INTERNAL_AGENT_K8S_NAMESPACE}-sandbox-manager-pv
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandbox-manager-config
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
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
        namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
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
      imagePullSecrets:
        - name: agentsmith-registry
      nodeSelector:
${NODE_SELECTOR_YAML}
      tolerations:
${TOLERATIONS_YAML}
      containers:
        - name: manager
          image: ${SANDBOX_MANAGER_IMAGE}
          imagePullPolicy: Always
          ports:
            - containerPort: 8080
          env:
            - name: CONFIG_PATH
              value: /etc/sandbox-manager/manager-config.yaml
            - name: SERVICE_KEYS
              value: ${SANDBOX_SERVICE_KEY}
            - name: K8S_NAMESPACE
              value: ${INTERNAL_AGENT_K8S_NAMESPACE}
            - name: JUICEFS_CSI_DRIVER
              value: ${INTERNAL_AGENT_JUICEFS_CSI_DRIVER}
            - name: JUICEFS_STORAGE_CAPACITY
              value: ${INTERNAL_AGENT_WORKSPACE_CAPACITY}
            - name: JUICEFS_STORAGE_CLASS_NAME
              value: ${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME}
            - name: JUICEFS_MOUNT_OPTIONS
              value: ${INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS}
            - name: JUICEFS_SUBDIR
              value: ${INTERNAL_AGENT_JUICEFS_SUBDIR}
            - name: JUICEFS_MOUNT_SERVICE_ACCOUNT
              value: ${INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT}
            - name: JUICEFS_MOUNT_IMAGE
              value: ${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE}
            - name: JUICEFS_STORAGE_ENDPOINT
              value: http://minio-external.${INTERNAL_AGENT_K8S_NAMESPACE}.svc.cluster.local:9000
            - name: JUICEFS_STORAGE_ACCESS_KEY
              value: ${MINIO_ROOT_USER}
            - name: JUICEFS_STORAGE_SECRET_KEY
              value: ${MINIO_ROOT_PASSWORD}
            - name: WORKLOAD_NODE_SELECTOR_JSON
              value: '${INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON}'
            - name: WORKLOAD_TOLERATIONS_JSON
              value: '${INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON}'
          resources:
            requests:
              cpu: ${SANDBOX_MANAGER_CPU_REQUEST}
              memory: ${SANDBOX_MANAGER_MEMORY_REQUEST}
            limits:
              cpu: ${SANDBOX_MANAGER_CPU_LIMIT}
              memory: ${SANDBOX_MANAGER_MEMORY_LIMIT}
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
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
spec:
  selector:
    app: sandbox-manager
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sandbox-manager
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
  annotations:
    kubernetes.io/ingress.class: ${SANDBOX_MANAGER_INGRESS_CLASS_NAME}
spec:
  ingressClassName: ${SANDBOX_MANAGER_INGRESS_CLASS_NAME}
  rules:
    - host: ${SANDBOX_MANAGER_INGRESS_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sandbox-manager
                port:
                  number: 80
EOF
kubectl apply -f "${MANAGER_MANIFEST}" >/dev/null
kubectl rollout status deployment/sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" --timeout=240s >/dev/null
wait_http "${SANDBOX_MANAGER_PUBLIC_BASE_URL}/readyz" 240

state_set release.phase deploy_completed
state_set release.id "${RELEASE_ID}"
state_set sandbox.url "${SANDBOX_MANAGER_PUBLIC_BASE_URL}"
log "deploy ok"
