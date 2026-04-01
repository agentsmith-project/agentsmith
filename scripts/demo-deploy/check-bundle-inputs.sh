#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST_PATH="${ROOT_DIR}/infra/deploy/demo/deployment.manifest.json"
SITE_ENV_EXAMPLE="${ROOT_DIR}/infra/deploy/demo/env/site.env.example"

python3 "${ROOT_DIR}/scripts/lib/check-required-env-templates.py" \
  "${MANIFEST_PATH}" \
  "${SITE_ENV_EXAMPLE}"

python3 - <<'PY' "${MANIFEST_PATH}" "${ROOT_DIR}"
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
root_dir = pathlib.Path(sys.argv[2])

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

for relative in manifest.get("bundle_files", []):
    source = root_dir / relative if not relative.startswith("tools/") else pathlib.Path("/nonexistent")
    if relative == "scripts/lib/common.sh":
      source = root_dir / "scripts" / "lib" / "common.sh"
    elif relative == "scripts/demo-deploy-modes-gate.sh":
      source = root_dir / "scripts" / "demo-deploy-modes-gate.sh"
    elif relative == "scripts/check-preset-external-file-library.sh":
      source = root_dir / "scripts" / "check-preset-external-file-library.sh"
    elif relative == "scripts/file-library-real-smoke.sh":
      source = root_dir / "scripts" / "file-library-real-smoke.sh"
    elif relative == "scripts/notebook-agent-refresh-token.js":
      source = root_dir / "scripts" / "notebook-agent-refresh-token.js"
    elif relative.startswith("scripts/lib/"):
      source = root_dir / "scripts" / "lib" / pathlib.Path(relative).name
    elif relative.startswith("scripts/substrate/"):
      source = root_dir / "scripts" / "substrate" / pathlib.Path(relative).name
    elif relative.startswith("scripts/app/"):
      source = root_dir / "scripts" / "app" / pathlib.Path(relative).name
    elif relative.startswith("infra/runtime/"):
      source = root_dir / "infra" / "runtime" / pathlib.Path(relative).name
    elif relative.startswith("scripts/"):
      source = root_dir / "scripts" / "demo-deploy" / pathlib.Path(relative).name
    elif relative.startswith("compose/"):
      source = root_dir / "infra" / "deploy" / "demo" / pathlib.Path(relative).name
    elif relative.startswith("env/"):
      source = root_dir / "infra" / "deploy" / "demo" / "env" / pathlib.Path(relative).name
    elif relative.startswith("kind/"):
      source = root_dir / "infra" / "deploy" / "demo" / "kind" / pathlib.Path(relative).name
    elif relative.startswith("k8s/"):
      source = root_dir / "infra" / "deploy" / "demo" / "k8s" / pathlib.Path(relative).name
    elif relative.startswith("universal-proxy/"):
      source = root_dir / "infra" / "deploy" / "shared" / "universal-proxy" / pathlib.Path(relative).name
    elif relative.startswith("docs/contracts/"):
      source = root_dir / relative
    elif relative.startswith("docs/user-guides/"):
      source = root_dir / relative
    elif relative == "README-demo-deploy.md":
      source = root_dir / relative
    elif relative.startswith("e2e/"):
      source = root_dir / relative
    elif relative in {"checksums.txt", "VERSION"}:
      continue
    elif relative.startswith("tools/"):
      continue
    if not source.exists():
        raise SystemExit(f"missing_bundle_source:{relative}:{source}")
PY

echo "[bundle-inputs] ok"
