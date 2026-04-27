#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/lib/release-check-common.sh"
release_check_init_tmp_root
RELEASE_ROOT="${TMP_ROOT}/release"
mkdir -p "${RELEASE_ROOT}/env"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env"

set_site_env_key() {
  local key="$1"
  local value="$2"
  python3 - <<'PY' "${RELEASE_ROOT}/env/site.env" "${key}" "${value}"
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines()
updated = []
replaced = False
for line in lines:
    if line.startswith(f"{key}="):
        updated.append(f"{key}={value}")
        replaced = True
    else:
        updated.append(line)
if not replaced:
    updated.append(f"{key}={value}")
path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
}

remove_site_env_keys() {
  python3 - <<'PY' "${RELEASE_ROOT}/env/site.env" "$@"
from pathlib import Path
import sys

path = Path(sys.argv[1])
remove = set(sys.argv[2:])
lines = path.read_text(encoding="utf-8").splitlines()
updated = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        updated.append(line)
        continue
    key = stripped.split("=", 1)[0]
    if key in remove:
        continue
    updated.append(line)
path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
}

set_site_env_key MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN fake-proxy-admin-token
set_site_env_key MBOS_UNIVERSAL_PROXY_DATA_TOKEN fake-proxy-data-token

cat > "${RELEASE_ROOT}/env/registry.env" <<'EOF'
REGISTRY_HOST=localhost:5001
REGISTRY_PROJECT=mbos
REGISTRY_USERNAME=
REGISTRY_PASSWORD=
K8S_REGISTRY_HOST=kind-registry:5000
EOF
cat > "${RELEASE_ROOT}/VERSION" <<'EOF'
release_id=test-release
agentsmith_app_image=localhost:5001/mbos/agentsmith-app:test-release
agentsmith_runner_image=localhost:5001/mbos/agentsmith-notebook-codex-runner:test-release
agentsmith_runner_k8s_image=kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release
agentsmith_chat_runner_image=localhost:5001/mbos/agentsmith-chat-llm-runner:test-release
agentsmith_chat_runner_k8s_image=kind-registry:5000/mbos/agentsmith-chat-llm-runner:test-release
agentsmith_verify_runner_image=localhost:5001/mbos/agentsmith-verify-runner:test-release
sandbox_manager_image=localhost:5001/mbos/sandbox-manager:test-release
sandbox_manager_k8s_image=kind-registry:5000/mbos/sandbox-manager:test-release
llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:test-release
juicefs_mount_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-mount:ce-v1.3.1
juicefs_csi_driver_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-juicefs-csi-driver:v0.31.3
juicefs_csi_dashboard_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-csi-dashboard:v0.31.3
juicefs_csi_provisioner_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-provisioner:v3.6.0
juicefs_csi_resizer_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-resizer:v1.9.0
juicefs_csi_livenessprobe_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-livenessprobe:v2.11.0
juicefs_csi_node_registrar_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-node-driver-registrar:v2.9.0
ingress_nginx_controller_image=localhost:5001/mbos/thirdparty-registry-k8s-io-ingress-nginx-controller:v1.12.1
ingress_nginx_certgen_image=localhost:5001/mbos/thirdparty-registry-k8s-io-ingress-nginx-kube-webhook-certgen:v1.6.9
registry_host=localhost:5001
k8s_registry_host=kind-registry:5000
registry_project=mbos
EOF

DEPLOY_ROOT="${TMP_ROOT}/cluster-root" RELEASE_ROOT="${RELEASE_ROOT}" \
  bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"

release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'SANDBOX_MANAGER_URL=https://sandbox-manager.mbos.imotion.ai' '[cluster-rendered-env] missing sandbox manager url'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_HTTP_BASE_URL=https://mbos.imotion.ai' '[cluster-rendered-env] missing internal agent execution http base'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_WS_BASE_URL=wss://mbos.imotion.ai' '[cluster-rendered-env] missing internal agent execution websocket base'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE=host.docker.internal' '[cluster-rendered-env] missing docker manual metadata host override'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://host.docker.internal:19000' '[cluster-rendered-env] missing docker manual storage endpoint override'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY=http://minio:9000' '[cluster-rendered-env] missing gateway storage endpoint override'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' '[cluster-rendered-env] missing universal proxy admin token'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token' '[cluster-rendered-env] missing proxy runtime admin token'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN=fake-proxy-data-token' '[cluster-rendered-env] missing universal proxy data token'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'LLM_UNIVERSAL_PROXY_DATA_TOKEN=fake-proxy-data-token' '[cluster-rendered-env] missing proxy runtime data token'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_DEFAULT_CPU_REQUEST=1' '[cluster-rendered-env] missing internal cpu request default'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(postgres|minio)(,|$)' '[cluster-rendered-env] missing compose no_proxy entries'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTP_PROXY=' '[cluster-rendered-env] missing cleared HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTPS_PROXY=' '[cluster-rendered-env] missing cleared HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'ALL_PROXY=' '[cluster-rendered-env] missing cleared ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'http_proxy=' '[cluster-rendered-env] missing cleared http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'https_proxy=' '[cluster-rendered-env] missing cleared https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'all_proxy=' '[cluster-rendered-env] missing cleared all_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=' '[cluster-rendered-env] missing cleared internal HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=' '[cluster-rendered-env] missing cleared internal HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=' '[cluster-rendered-env] missing cleared internal ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=' '[cluster-rendered-env] missing cleared internal http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=' '[cluster-rendered-env] missing cleared internal https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=' '[cluster-rendered-env] missing cleared internal all_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.mbos.svc.cluster.local' '[cluster-rendered-env] missing internal postgres external fqdn'

set_site_env_key RUNTIME_PROXY_MODE custom
set_site_env_key RUNTIME_HTTP_PROXY http://cluster-custom-http.proxy.internal:8080
set_site_env_key RUNTIME_HTTPS_PROXY http://cluster-custom-https.proxy.internal:8443
set_site_env_key RUNTIME_ALL_PROXY socks5://cluster-custom-all.proxy.internal:1080
set_site_env_key RUNTIME_ADDITIONAL_NO_PROXY cluster.internal,registry.internal

HTTP_PROXY=http://ambient-http.proxy.internal:8080 \
HTTPS_PROXY=http://ambient-https.proxy.internal:8443 \
ALL_PROXY=socks5://ambient-all.proxy.internal:1080 \
DEPLOY_ROOT="${TMP_ROOT}/cluster-root-custom" RELEASE_ROOT="${RELEASE_ROOT}" \
  bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"

release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTP_PROXY=http://cluster-custom-http.proxy.internal:8080' '[cluster-rendered-env] missing custom HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'HTTPS_PROXY=http://cluster-custom-https.proxy.internal:8443' '[cluster-rendered-env] missing custom HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'ALL_PROXY=socks5://cluster-custom-all.proxy.internal:1080' '[cluster-rendered-env] missing custom ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'http_proxy=http://cluster-custom-http.proxy.internal:8080' '[cluster-rendered-env] missing custom http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'https_proxy=http://cluster-custom-https.proxy.internal:8443' '[cluster-rendered-env] missing custom https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/base.env" 'all_proxy=socks5://cluster-custom-all.proxy.internal:1080' '[cluster-rendered-env] missing custom all_proxy'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(cluster.internal|registry.internal)(,|$)' '[cluster-rendered-env] missing custom compose no_proxy entries'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTP_PROXY=http://cluster-custom-http.proxy.internal:8080' '[cluster-rendered-env] missing custom internal HTTP_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'HTTPS_PROXY=http://cluster-custom-https.proxy.internal:8443' '[cluster-rendered-env] missing custom internal HTTPS_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'ALL_PROXY=socks5://cluster-custom-all.proxy.internal:1080' '[cluster-rendered-env] missing custom internal ALL_PROXY'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'http_proxy=http://cluster-custom-http.proxy.internal:8080' '[cluster-rendered-env] missing custom internal http_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'https_proxy=http://cluster-custom-https.proxy.internal:8443' '[cluster-rendered-env] missing custom internal https_proxy'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'all_proxy=socks5://cluster-custom-all.proxy.internal:1080' '[cluster-rendered-env] missing custom internal all_proxy'
release_check_forbid_pattern "${RELEASE_ROOT}/env/base.env" 'ambient-http\.proxy\.internal' '[cluster-rendered-env] unexpected ambient base proxy'
release_check_forbid_pattern "${RELEASE_ROOT}/env/internal.env" 'ambient-http\.proxy\.internal' '[cluster-rendered-env] unexpected ambient internal proxy'

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
text = text.replace("MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=", "MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fake-proxy-admin-token")
text = text.replace("MBOS_UNIVERSAL_PROXY_DATA_TOKEN=", "MBOS_UNIVERSAL_PROXY_DATA_TOKEN=fake-proxy-data-token")
(release / "env/site.env.example").write_text(text, encoding="utf-8")
(release / "env/site.env").write_text(text, encoding="utf-8")
(release / "env/registry.env").write_text(
    "\n".join(
        [
            "REGISTRY_HOST=localhost:5001",
            "REGISTRY_PROJECT=mbos",
            "REGISTRY_USERNAME=",
            "REGISTRY_PASSWORD=",
            "K8S_REGISTRY_HOST=kind-registry:5000",
            "",
        ]
    ),
    encoding="utf-8",
)
(release / "VERSION").write_text(
    "\n".join(
        [
            "release_id=test-release",
            "agentsmith_app_image=localhost:5001/mbos/agentsmith-app:test-release",
            "agentsmith_runner_image=localhost:5001/mbos/agentsmith-notebook-codex-runner:test-release",
            "agentsmith_runner_k8s_image=kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release",
            "agentsmith_chat_runner_image=localhost:5001/mbos/agentsmith-chat-llm-runner:test-release",
            "agentsmith_chat_runner_k8s_image=kind-registry:5000/mbos/agentsmith-chat-llm-runner:test-release",
            "agentsmith_verify_runner_image=localhost:5001/mbos/agentsmith-verify-runner:test-release",
            "sandbox_manager_image=localhost:5001/mbos/sandbox-manager:test-release",
            "sandbox_manager_k8s_image=kind-registry:5000/mbos/sandbox-manager:test-release",
            "llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:test-release",
            "juicefs_mount_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-mount:ce-v1.3.1",
            "juicefs_csi_driver_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-juicefs-csi-driver:v0.31.3",
            "juicefs_csi_dashboard_image=localhost:5001/mbos/thirdparty-docker-io-juicedata-csi-dashboard:v0.31.3",
            "juicefs_csi_provisioner_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-provisioner:v3.6.0",
            "juicefs_csi_resizer_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-resizer:v1.9.0",
            "juicefs_csi_livenessprobe_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-livenessprobe:v2.11.0",
            "juicefs_csi_node_registrar_image=localhost:5001/mbos/thirdparty-registry-k8s-io-sig-storage-csi-node-driver-registrar:v2.9.0",
            "ingress_nginx_controller_image=localhost:5001/mbos/thirdparty-registry-k8s-io-ingress-nginx-controller:v1.12.1",
            "ingress_nginx_certgen_image=localhost:5001/mbos/thirdparty-registry-k8s-io-ingress-nginx-kube-webhook-certgen:v1.6.9",
            "registry_host=localhost:5001",
            "k8s_registry_host=kind-registry:5000",
            "registry_project=mbos",
            "",
        ]
    ),
    encoding="utf-8",
)
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

remove_site_env_keys RUNTIME_PROXY_MODE RUNTIME_HTTP_PROXY RUNTIME_HTTPS_PROXY RUNTIME_ALL_PROXY RUNTIME_ADDITIONAL_NO_PROXY
set +e
missing_runtime_proxy_output="$(
  RUNTIME_PROXY_MODE=inherit \
  RUNTIME_HTTP_PROXY=http://ambient-http.proxy.internal:8080 \
  RUNTIME_HTTPS_PROXY=http://ambient-https.proxy.internal:8443 \
  RUNTIME_ALL_PROXY=socks5://ambient-all.proxy.internal:1080 \
  RUNTIME_ADDITIONAL_NO_PROXY=ambient.internal \
  DEPLOY_ROOT="${TMP_ROOT}/cluster-root-missing-runtime-proxy" RELEASE_ROOT="${RELEASE_ROOT}" \
  bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh" 2>&1
)"
missing_runtime_proxy_status=$?
set -e
if [[ "${missing_runtime_proxy_status}" == "0" ]]; then
  echo '[cluster-rendered-env] unexpected success without runtime proxy keys' >&2
  exit 1
fi
printf '%s' "${missing_runtime_proxy_output}" | grep -F 'missing required site.env key: RUNTIME_PROXY_MODE' >/dev/null || {
  echo '[cluster-rendered-env] missing runtime proxy key failure message' >&2
  exit 1
}

echo "[cluster-rendered-env] ok"
