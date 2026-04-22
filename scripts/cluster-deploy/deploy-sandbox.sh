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
ensure_operator_manager_kubeconfig
ensure_admin_ready
load_registry_env
load_kubeconfig
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
bash "${ROOT_DIR}/scripts/cluster-deploy/apply-kind-dns.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
require_version_images

[[ -n "${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" ]] \
  || die "INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME must be set before deploy-sandbox; complete the cluster admin handoff first"

manager_can_i() {
  local check="$1"
  if [[ "$(cluster_deploy_mode)" == "full-auto" ]]; then
    KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl auth can-i ${check} \
      --as="system:serviceaccount:${INTERNAL_AGENT_K8S_NAMESPACE}:agentsmith-manager" 2>/dev/null || true
  else
    KUBECONFIG="${SHARED_MANAGER_KUBECONFIG}" kubectl auth can-i ${check} 2>/dev/null || true
  fi
}

for check in \
  "create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "create persistentvolumeclaims -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "create pods -n ${INTERNAL_AGENT_K8S_NAMESPACE}" \
  "get persistentvolumes" \
  "create persistentvolumes" \
  "update persistentvolumes" \
  "delete persistentvolumes"; do
  if [[ "$(manager_can_i "${check}")" != "yes" ]]; then
    die "manager runtime identity is missing required permission: ${check}"
  fi
done

IMAGE_PULL_SECRETS_YAML=""
JOB_IMAGE_PULL_SECRETS_YAML=""
if [[ -n "${REGISTRY_USERNAME:-}" || -n "${REGISTRY_PASSWORD:-}" ]]; then
  [[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] \
    || die "registry auth requires both REGISTRY_USERNAME and REGISTRY_PASSWORD"
  kubectl create secret docker-registry agentsmith-registry \
    --namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" \
    --docker-server="${REGISTRY_HOST}" \
    --docker-username="${REGISTRY_USERNAME}" \
    --docker-password="${REGISTRY_PASSWORD}" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl patch serviceaccount default \
    --namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" \
    --type merge \
    -p '{"imagePullSecrets":[{"name":"agentsmith-registry"}]}' >/dev/null
  IMAGE_PULL_SECRETS_YAML=$(cat <<'EOF'
      imagePullSecrets:
        - name: agentsmith-registry
EOF
)
  JOB_IMAGE_PULL_SECRETS_YAML=$(cat <<'EOF'
          imagePullSecrets:
            - name: agentsmith-registry
EOF
)
fi

RUNTIME_MANAGER_KUBECONFIG="${STATE_DIR}/manager-kubeconfig.runtime"
KUBERNETES_SERVICE_DNS_NAME="kubernetes.default.svc"
python3 - "${SHARED_MANAGER_KUBECONFIG}" "${RUNTIME_MANAGER_KUBECONFIG}" "${KUBERNETES_SERVICE_DNS_NAME}" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
cluster_host = sys.argv[3].strip()
if not cluster_host:
    raise SystemExit("failed to resolve kubernetes service DNS host")

lines = src.read_text(encoding="utf-8").splitlines()
rewritten = []
replaced = False
for line in lines:
    if line.strip().startswith("server: https://"):
        indent = line[: len(line) - len(line.lstrip())]
        rewritten.append(f"{indent}server: https://{cluster_host}:443")
        replaced = True
    else:
        rewritten.append(line)
if not replaced:
    raise SystemExit("failed to rewrite manager kubeconfig server")
dst.write_text("\n".join(rewritten) + "\n", encoding="utf-8")
PY

kubectl create secret generic agentsmith-manager-kubeconfig \
  --namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" \
  --from-file=config="${RUNTIME_MANAGER_KUBECONFIG}" \
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
if [[ -z "${NODE_SELECTOR_YAML}" ]]; then
  NODE_SELECTOR_BLOCK="      nodeSelector: {}"
  JOB_NODE_SELECTOR_BLOCK="          nodeSelector: {}"
else
  NODE_SELECTOR_BLOCK="$(cat <<EOF
      nodeSelector:
${NODE_SELECTOR_YAML}
EOF
)"
  JOB_NODE_SELECTOR_YAML="$(python3 -c 'import json,sys; data=json.loads(sys.argv[1]); print("\n".join([f"            {k}: {v}" for k,v in data.items()]))' "${SANDBOX_MANAGER_NODE_SELECTOR_JSON}")"
  JOB_NODE_SELECTOR_BLOCK="$(cat <<EOF
          nodeSelector:
${JOB_NODE_SELECTOR_YAML}
EOF
)"
fi
if [[ -z "${TOLERATIONS_YAML}" ]]; then
  TOLERATIONS_BLOCK="      tolerations: []"
  JOB_TOLERATIONS_BLOCK="          tolerations: []"
else
  TOLERATIONS_BLOCK="$(cat <<EOF
      tolerations:
${TOLERATIONS_YAML}
EOF
)"
  JOB_TOLERATIONS_YAML="$(python3 -c 'import json,sys; data=json.loads(sys.argv[1]); lines=[];
for item in data:
 lines.append("            - key: " + item.get("key",""))
 op=item.get("operator")
 if op: lines.append("              operator: " + op)
 val=item.get("value")
 if val is not None: lines.append("              value: " + str(val))
 eff=item.get("effect")
 if eff: lines.append("              effect: " + eff)
 sec=item.get("tolerationSeconds")
 if sec is not None: lines.append("              tolerationSeconds: " + str(sec))
print("\n".join(lines))' "${SANDBOX_MANAGER_TOLERATIONS_JSON}")"
  JOB_TOLERATIONS_BLOCK="$(cat <<EOF
          tolerations:
${JOB_TOLERATIONS_YAML}
EOF
)"
fi
INGRESS_RULE_HOST_BLOCK=""
if [[ -n "${SANDBOX_MANAGER_INGRESS_HOST:-}" ]]; then
  INGRESS_RULE_HOST_BLOCK="$(cat <<EOF
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
)"
else
  INGRESS_RULE_HOST_BLOCK="$(cat <<'EOF'
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sandbox-manager
                port:
                  number: 80
EOF
)"
fi
cat > "${MANAGER_MANIFEST}" <<EOF
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
      automountServiceAccountToken: false
${IMAGE_PULL_SECRETS_YAML}
${NODE_SELECTOR_BLOCK}
${TOLERATIONS_BLOCK}
      containers:
        - name: manager
          image: ${K8S_SANDBOX_MANAGER_IMAGE}
          imagePullPolicy: ${SANDBOX_MANAGER_IMAGE_PULL_POLICY:-IfNotPresent}
          ports:
            - containerPort: 8080
          env:
            - name: CONFIG_PATH
              value: /etc/sandbox-manager/manager-config.yaml
            - name: KUBECONFIG
              value: /etc/cluster-kubeconfig/config
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
              value: '${INTERNAL_AGENT_JUICEFS_SUBDIR}'
            - name: JUICEFS_MOUNT_SERVICE_ACCOUNT
              value: ${INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT}
            - name: JUICEFS_MOUNT_IMAGE
              value: ${K8S_JUICEFS_MOUNT_IMAGE}
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
            - name: kubeconfig
              mountPath: /etc/cluster-kubeconfig
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: sandbox-manager-config
        - name: kubeconfig
          secret:
            secretName: agentsmith-manager-kubeconfig
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sandbox-manager-cleaner
  namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
spec:
  schedule: "*/1 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: agentsmith-manager
${JOB_IMAGE_PULL_SECRETS_YAML}
${JOB_NODE_SELECTOR_BLOCK}
${JOB_TOLERATIONS_BLOCK}
          restartPolicy: Never
          containers:
            - name: cleaner
              image: ${K8S_SANDBOX_MANAGER_IMAGE}
              imagePullPolicy: ${SANDBOX_MANAGER_IMAGE_PULL_POLICY:-IfNotPresent}
              command:
                - /cleaner
                - --namespace=${INTERNAL_AGENT_K8S_NAMESPACE}
                - --dry-run=false
                - --log-level=info
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 500m
                  memory: 512Mi
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
${INGRESS_RULE_HOST_BLOCK}
EOF
kubectl apply -f "${MANAGER_MANIFEST}" >/dev/null
kubectl rollout status deployment/sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" --timeout=240s >/dev/null
wait_http "${SANDBOX_MANAGER_PUBLIC_BASE_URL}/readyz" 240

state_set release.phase deploy_sandbox_completed
state_set sandbox.url "${SANDBOX_MANAGER_PUBLIC_BASE_URL}"
log "deploy-sandbox ok"
