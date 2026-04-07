#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/lib/release-check-common.sh"
release_check_init_tmp_root
RELEASE_ROOT="${TMP_ROOT}/release"
mkdir -p "${RELEASE_ROOT}/env"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${RELEASE_ROOT}/env/site.env"
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
agentsmith_runner_image=localhost:5001/mbos/agentsmith-codex-runner:test-release
agentsmith_runner_k8s_image=kind-registry:5000/mbos/agentsmith-codex-runner:test-release
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
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_HTTP_BASE_URL=https://mbos.imotion.ai/api/v1' '[cluster-rendered-env] missing internal agent execution http base'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'AGENT_EXECUTION_WS_BASE_URL=wss://mbos.imotion.ai/api/v1' '[cluster-rendered-env] missing internal agent execution websocket base'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE=host.docker.internal' '[cluster-rendered-env] missing docker manual metadata host override'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=http://host.docker.internal:19000' '[cluster-rendered-env] missing docker manual storage endpoint override'
release_check_require_exact_line "${RELEASE_ROOT}/env/api.env" 'JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY=http://minio:9000' '[cluster-rendered-env] missing gateway storage endpoint override'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_DEFAULT_CPU_REQUEST=1' '[cluster-rendered-env] missing internal cpu request default'
release_check_require_pattern "${RELEASE_ROOT}/env/base.env" '^NO_PROXY=.*(^|,)(postgres|minio)(,|$)' '[cluster-rendered-env] missing compose no_proxy entries'
release_check_require_exact_line "${RELEASE_ROOT}/env/internal.env" 'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=postgres-external.mbos.svc.cluster.local' '[cluster-rendered-env] missing internal postgres external fqdn'

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
            "agentsmith_runner_image=localhost:5001/mbos/agentsmith-codex-runner:test-release",
            "agentsmith_runner_k8s_image=kind-registry:5000/mbos/agentsmith-codex-runner:test-release",
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

echo "[cluster-rendered-env] ok"
