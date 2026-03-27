#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST_PATH="${ROOT_DIR}/infra/deploy/cluster/deployment.manifest.json"
SITE_ENV_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/site.env.example"
REGISTRY_ENV_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/registry.env.example"
KUBECONFIG_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/kubeconfig.example.yaml"
ADMIN_KUBECONFIG_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/admin-kubeconfig.example.yaml"
MANAGER_KUBECONFIG_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/manager-kubeconfig.example.yaml"

python3 - <<'PY' "${MANIFEST_PATH}" "${SITE_ENV_EXAMPLE}" "${REGISTRY_ENV_EXAMPLE}" "${KUBECONFIG_EXAMPLE}" "${ADMIN_KUBECONFIG_EXAMPLE}" "${MANAGER_KUBECONFIG_EXAMPLE}" "${ROOT_DIR}"
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
site_env_path = pathlib.Path(sys.argv[2])
registry_env_path = pathlib.Path(sys.argv[3])
kubeconfig_path = pathlib.Path(sys.argv[4])
admin_kubeconfig_path = pathlib.Path(sys.argv[5])
manager_kubeconfig_path = pathlib.Path(sys.argv[6])
root_dir = pathlib.Path(sys.argv[7])

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

env_keys = set()
for raw_line in site_env_path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    env_keys.add(line.split('=', 1)[0].strip())

for group_name, group in manifest.get("required_env", {}).items():
    for key in group:
        if key not in env_keys:
            raise SystemExit(f"missing_env_template_key:{group_name}:{key}")

if "REGISTRY_HOST" not in registry_env_path.read_text(encoding='utf-8'):
    raise SystemExit("missing_registry_host_template")
if not kubeconfig_path.exists():
    raise SystemExit("missing_kubeconfig_example")
if not admin_kubeconfig_path.exists():
    raise SystemExit("missing_admin_kubeconfig_example")
if not manager_kubeconfig_path.exists():
    raise SystemExit("missing_manager_kubeconfig_example")

for relative in manifest.get("bundle_files", []):
    source = root_dir / relative
    if relative.startswith("compose/"):
        source = root_dir / "infra" / "deploy" / "cluster" / pathlib.Path(relative).name
    elif relative.startswith("env/"):
        source = root_dir / "infra" / "deploy" / "cluster" / "env" / pathlib.Path(relative).name
    elif relative.startswith("infra/deploy/cluster/admin-examples/"):
        source = root_dir / relative
    elif relative.startswith("addons/ingress-nginx/"):
        source = root_dir / "infra" / "deploy" / "cluster" / "addons" / "ingress-nginx" / pathlib.Path(relative).name
    elif relative.startswith("addons/juicefs-csi/"):
        source = root_dir / "infra" / "deploy" / "cluster" / "addons" / "juicefs-csi" / pathlib.Path(relative).name
    elif relative.startswith("postgres-init/"):
        source = root_dir / "infra" / "integration" / "postgres-init" / pathlib.Path(relative).name
        if pathlib.Path(relative).name == "projects.sql":
            source = root_dir / "packages" / "adapters-private" / "sql" / "projects.sql"
    elif relative.startswith("minio/"):
        source = root_dir / "infra" / "integration" / "minio" / pathlib.Path(relative).name
    elif relative.startswith("keycloak/"):
        source = root_dir / "infra" / "integration" / "keycloak" / pathlib.Path(relative).name
    elif relative.startswith("universal-proxy/"):
        source = root_dir / "infra" / "deploy" / "shared" / "universal-proxy" / pathlib.Path(relative).name
    elif relative.startswith("scripts/cluster-deploy/"):
        source = root_dir / relative
    elif relative == "scripts/check-preset-external-file-library.sh":
        source = root_dir / "scripts" / "check-preset-external-file-library.sh"
    elif relative.startswith("scripts/lib/"):
        source = root_dir / "scripts" / "lib" / pathlib.Path(relative).name
    elif relative.startswith("infra/runtime/"):
        source = root_dir / "infra" / "runtime" / pathlib.Path(relative).name
    elif relative.startswith("docs/"):
        source = root_dir / relative
    elif relative.startswith("e2e/"):
        source = root_dir / relative
    elif relative == "sources/agentsmith":
        source = root_dir
    elif relative == "sources/mbos-sandbox-v1/manager-service":
        source = root_dir.parent / "mbos-sandbox-v1" / "manager-service"
    elif relative == "sources/llm-universal-proxy":
        source = root_dir.parent / "llm-universal-proxy"
    elif relative in {"checksums.txt", "VERSION"}:
        continue
    if not source.exists():
        raise SystemExit(f"missing_bundle_source:{relative}:{source}")
PY

cluster_automation_files=(
  "${ROOT_DIR}/scripts/cluster-deploy/prepare.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/publish-images.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/deploy-substrate.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/deploy-app.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/deploy.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/bootstrap.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/verify.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/report.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/reset.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
  "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
)

full_auto_cluster_scope_files=(
  "${ROOT_DIR}/scripts/cluster-deploy/apply-cluster-prereqs.sh"
)

for forbidden in \
  "kubectl create namespace" \
  "kubectl delete namespace" \
  "kube-system" \
  "ClusterRole" \
  "ClusterRoleBinding"; do
  if rg -n "${forbidden}" "${cluster_automation_files[@]}" >/dev/null; then
    echo "cluster-deploy automation must stay namespace-only; found forbidden token: ${forbidden}" >&2
    exit 1
  fi
done

for required in "${full_auto_cluster_scope_files[@]}"; do
  [[ -f "${required}" ]] || {
    echo "missing full-auto cluster-scope script: ${required}" >&2
    exit 1
  }
done

echo "[cluster-bundle-inputs] ok"
