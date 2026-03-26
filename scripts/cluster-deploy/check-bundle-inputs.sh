#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST_PATH="${ROOT_DIR}/infra/deploy/cluster/deployment.manifest.json"
SITE_ENV_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/site.env.example"
REGISTRY_ENV_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/registry.env.example"
KUBECONFIG_EXAMPLE="${ROOT_DIR}/infra/deploy/cluster/env/kubeconfig.example.yaml"

python3 - <<'PY' "${MANIFEST_PATH}" "${SITE_ENV_EXAMPLE}" "${REGISTRY_ENV_EXAMPLE}" "${KUBECONFIG_EXAMPLE}" "${ROOT_DIR}"
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
site_env_path = pathlib.Path(sys.argv[2])
registry_env_path = pathlib.Path(sys.argv[3])
kubeconfig_path = pathlib.Path(sys.argv[4])
root_dir = pathlib.Path(sys.argv[5])

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

for relative in manifest.get("bundle_files", []):
    source = root_dir / relative
    if relative.startswith("compose/"):
        source = root_dir / "infra" / "deploy" / "cluster" / pathlib.Path(relative).name
    elif relative.startswith("env/"):
        source = root_dir / "infra" / "deploy" / "cluster" / "env" / pathlib.Path(relative).name
    elif relative.startswith("k8s/"):
        source = root_dir / "infra" / "deploy" / "remote" / "k8s" / pathlib.Path(relative).name
    elif relative.startswith("postgres-init/"):
        source = root_dir / "infra" / "integration" / "postgres-init" / pathlib.Path(relative).name
        if pathlib.Path(relative).name == "projects.sql":
            source = root_dir / "packages" / "adapters-private" / "sql" / "projects.sql"
    elif relative.startswith("minio/"):
        source = root_dir / "infra" / "integration" / "minio" / pathlib.Path(relative).name
    elif relative.startswith("keycloak/"):
        source = root_dir / "infra" / "integration" / "keycloak" / pathlib.Path(relative).name
    elif relative.startswith("universal-proxy/"):
        source = root_dir / "infra" / "deploy" / "remote" / "universal-proxy" / pathlib.Path(relative).name
    elif relative.startswith("scripts/cluster-deploy/"):
        source = root_dir / relative
    elif relative == "scripts/remote-deploy/lib/common.sh":
        source = root_dir / "scripts" / "remote-deploy" / "lib" / "common.sh"
    elif relative == "scripts/remote-deploy/bootstrap.sh":
        source = root_dir / "scripts" / "remote-deploy" / "bootstrap.sh"
    elif relative == "scripts/lib/k8s-external-services.sh":
        source = root_dir / "scripts" / "lib" / "k8s-external-services.sh"
    elif relative.startswith("docs/"):
        source = root_dir / relative
    elif relative.startswith("e2e/"):
        source = root_dir / relative
    elif relative in {"checksums.txt", "VERSION"}:
        continue
    if not source.exists():
        raise SystemExit(f"missing_bundle_source:{relative}:{source}")
PY

echo "[cluster-bundle-inputs] ok"
