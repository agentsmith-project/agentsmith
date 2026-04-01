#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

ensure_dirs
for cmd in docker curl tar sha256sum; do
  require_cmd "${cmd}"
done
require_release_path "${RELEASE_ROOT}/deployment.manifest.json" "deployment.manifest.json"
require_release_path "${RELEASE_ROOT}/docs/contracts/deployment-spec-v1.md" "deployment-spec-v1.md"
require_release_path "${TOOLS_DIR}/kind" "bundled kind" "exe"
require_release_path "${TOOLS_DIR}/kubectl" "bundled kubectl" "exe"
require_release_path "${RELEASE_ROOT}/compose/docker-compose.yml" "compose asset"
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

env_keys = set()
for env_file in (release_root / "env").glob("*.example"):
    for raw_line in env_file.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        env_keys.add(line.split("=", 1)[0].strip())

for group in manifest.get("required_env", {}).values():
    for key in group:
        if key not in env_keys:
            raise SystemExit(f"missing_release_env_template:{key}")
PY

SITE_ENV_PATH="${RELEASE_ROOT}/env/site.env"
if [[ ! -f "${SITE_ENV_PATH}" ]]; then
  SITE_ENV_PATH="${RELEASE_ROOT}/env/site.env.example"
fi

DEMO_DEPLOY_MODE="$(
  python3 - <<'PY' "${SITE_ENV_PATH}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
mode = "full"
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key.strip() == 'DEMO_DEPLOY_MODE':
        mode = value.strip().strip('"').strip("'") or "full"
        break
print(mode)
PY
)"
case "${DEMO_DEPLOY_MODE}" in
  full|simple) ;;
  *) die "invalid DEMO_DEPLOY_MODE in ${SITE_ENV_PATH}: ${DEMO_DEPLOY_MODE}" ;;
esac

mapfile -t PORT_ROWS < <(python3 - <<'PY' "${SITE_ENV_PATH}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
values = {}
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    values[key.strip()] = value.strip().strip('"').strip("'")

for name in [
    'POSTGRES_PORT',
    'MONGO_PORT',
    'REDIS_PORT',
    'MINIO_API_PORT',
    'MINIO_CONSOLE_PORT',
    'KEYCLOAK_PORT',
    'API_PORT',
    'WEB_PORT',
]:
    value = values.get(name)
    if value:
        print(f"{name}:{value}")
PY
)

if [[ "${DEMO_DEPLOY_MODE}" == "full" ]]; then
  sandbox_port="$(
    python3 - <<'PY' "${SITE_ENV_PATH}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key.strip() == 'SANDBOX_HOST_PORT':
        print(value.strip().strip('"').strip("'"))
        break
PY
  )"
  if [[ -n "${sandbox_port}" ]]; then
    PORT_ROWS+=("SANDBOX_HOST_PORT:${sandbox_port}")
  fi
fi

for row in "${PORT_ROWS[@]}"; do
  name="${row%%:*}"
  port="${row##*:}"
  if python3 - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(0.5)
try:
    sys.exit(0 if sock.connect_ex(('127.0.0.1', port)) == 0 else 1)
finally:
    sock.close()
PY
  then
    owner_lines="$(docker ps --format '{{.Names}}\t{{.Ports}}' | awk -v port="${port}" 'index($0, ":" port "->") { print }')"
    if [[ -n "${owner_lines}" ]] && printf '%s\n' "${owner_lines}" | awk -F'\t' '
      $1 ~ /^agentsmith-demo-/ { next }
      $1 == "agentsmith-control-plane" { next }
      { exit 1 }
      END { exit 0 }
    '; then
      log "port ${port} already in use by current AgentSmith deployment resources; reset will clear it"
      continue
    fi
    die "port_in_use:${name}:${port}"
  fi
done

state_set release.phase prepare_completed
log "prepare ok"
