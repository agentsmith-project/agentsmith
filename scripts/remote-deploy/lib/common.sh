#!/usr/bin/env bash
set -euo pipefail

REMOTE_DEPLOY_ROOT_DEFAULT="${HOME}/agentsmith-deploy"
REMOTE_DEPLOY_ROOT="${REMOTE_DEPLOY_ROOT:-${REMOTE_DEPLOY_ROOT_DEFAULT}}"
CURRENT_LINK="${REMOTE_DEPLOY_ROOT}/current"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -z "${RELEASE_ROOT:-}" ]]; then
  if [[ -f "${CURRENT_LINK}/VERSION" ]]; then
    RELEASE_ROOT="$(readlink -f "${CURRENT_LINK}")"
  else
    RELEASE_ROOT="${REMOTE_DEPLOY_ROOT}/releases/${RELEASE_ID}"
  fi
elif [[ -e "${RELEASE_ROOT}" ]]; then
  RELEASE_ROOT="$(cd -P "${RELEASE_ROOT}" && pwd)"
fi
if [[ -d "${RELEASE_ROOT}/scripts/lib" ]]; then
  RELEASE_SCRIPT_DIR="${RELEASE_ROOT}/scripts"
else
  RELEASE_SCRIPT_DIR="${RELEASE_ROOT}/scripts/remote-deploy"
fi
STATE_DIR="${REMOTE_DEPLOY_ROOT}/state"
LOG_DIR="${REMOTE_DEPLOY_ROOT}/logs"
REPORT_DIR="${REMOTE_DEPLOY_ROOT}/reports"
TOOLS_DIR="${RELEASE_ROOT}/tools"
ORIGINAL_PATH="${PATH}"
resolve_tool() {
  local bundled="$1"
  local system_name="$2"
  shift 2
  if [[ -x "${bundled}" ]] && "${bundled}" "$@" >/dev/null 2>&1; then
    printf '%s\n' "${bundled}"
    return 0
  fi
  PATH="${ORIGINAL_PATH}" command -v "${system_name}"
}

KIND_BIN="$(resolve_tool "${TOOLS_DIR}/kind" kind --version)"
KUBECTL_BIN="$(resolve_tool "${TOOLS_DIR}/kubectl" kubectl version --client)"
JQ_BIN=""
if PATH="${ORIGINAL_PATH}" command -v jq >/dev/null 2>&1 || [[ -x "${TOOLS_DIR}/jq" ]]; then
  JQ_BIN="$(resolve_tool "${TOOLS_DIR}/jq" jq --version || true)"
fi

kind() { "${KIND_BIN}" "$@"; }
kubectl() { "${KUBECTL_BIN}" "$@"; }
jq() {
  if [[ -z "${JQ_BIN}" ]]; then
    printf 'jq not available\n' >&2
    return 127
  fi
  "${JQ_BIN}" "$@"
}

log() { printf '[remote-deploy] %s\n' "$*"; }
die() { printf '[remote-deploy] ERROR: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

ensure_dirs() {
  mkdir -p "${REMOTE_DEPLOY_ROOT}" "${STATE_DIR}" "${LOG_DIR}" "${REPORT_DIR}"
}

load_release_env() {
  local env_file
  for env_file in \
    "${RELEASE_ROOT}/env/base.env" \
    "${RELEASE_ROOT}/env/keycloak.env" \
    "${RELEASE_ROOT}/env/api.env" \
    "${RELEASE_ROOT}/env/web.env" \
    "${RELEASE_ROOT}/env/internal.env" \
    "${RELEASE_ROOT}/env/runner.env"; do
    if [[ -f "${env_file}" ]]; then
      while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
        local line="${raw_line#"${raw_line%%[![:space:]]*}"}"
        [[ -z "${line}" || "${line}" == \#* || "${line}" != *=* ]] && continue
        local key="${line%%=*}"
        local value="${line#*=}"
        export "${key}=${value}"
      done < "${env_file}"
    fi
  done
}

state_file() { printf '%s/deploy-state.json\n' "${STATE_DIR}"; }

ensure_state() {
  ensure_dirs
  if [[ ! -f "$(state_file)" ]]; then
    printf '{}\n' > "$(state_file)"
  fi
}

state_set() {
  local key="$1"
  local value="${2-}"
  ensure_state
  python3 - <<'PY' "$(state_file)" "${key}" "${value}"
import json
import pathlib
import sys

file_path = pathlib.Path(sys.argv[1])
path = [part for part in sys.argv[2].split('.') if part]
value = sys.argv[3]
data = json.loads(file_path.read_text(encoding='utf-8'))
cursor = data
for part in path[:-1]:
    existing = cursor.get(part)
    if not isinstance(existing, dict):
        existing = {}
        cursor[part] = existing
    cursor = existing
if path:
    cursor[path[-1]] = value
file_path.write_text(json.dumps(data, indent=2) + "\n", encoding='utf-8')
PY
}

state_get() {
  local key="$1"
  ensure_state
  python3 - <<'PY' "$(state_file)" "${key}"
import json
import pathlib
import sys

file_path = pathlib.Path(sys.argv[1])
path = [part for part in sys.argv[2].split('.') if part]
data = json.loads(file_path.read_text(encoding='utf-8'))
value = data
for part in path:
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(2)
    value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
PY
}

copy_example_env() {
  local name="$1"
  local src="${RELEASE_ROOT}/env/${name}.example"
  local dst="${RELEASE_ROOT}/env/${name}"
  if [[ -f "${src}" && ! -f "${dst}" ]]; then
    cp "${src}" "${dst}"
  fi
}

docker_compose() {
  if [[ -f "${RELEASE_ROOT}/compose/.env" ]]; then
    docker compose --env-file "${RELEASE_ROOT}/compose/.env" -f "${RELEASE_ROOT}/compose/docker-compose.yml" "$@"
  else
    docker compose -f "${RELEASE_ROOT}/compose/docker-compose.yml" "$@"
  fi
}

write_compose_env() {
  local app_image="${1:-}"
  local runner_image="${2:-}"
  mkdir -p "${RELEASE_ROOT}/compose"
  cat > "${RELEASE_ROOT}/compose/.env" <<EOF
AGENTSMITH_APP_IMAGE=${app_image}
AGENTSMITH_RUNNER_IMAGE=${runner_image}
EOF
}

kind_gateway_ip() {
  local gateway
  gateway="$(
    docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
      | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
  )"
  if [[ -n "${gateway}" ]]; then
    printf '%s\n' "${gateway}"
  else
    printf '172.18.0.1\n'
  fi
}

wait_http() {
  local url="$1"
  local timeout="${2:-180}"
  local started
  started="$(date +%s)"
  until curl -fsS "${url}" >/dev/null 2>&1; do
    if (( "$(date +%s)" - started > timeout )); then
      die "timeout waiting for ${url}"
    fi
    sleep 2
  done
}

wait_tcp() {
  local host="$1"
  local port="$2"
  local timeout="${3:-180}"
  local started
  started="$(date +%s)"
  until python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
try:
    sock.connect((host, port))
except OSError:
    sys.exit(1)
else:
    sock.close()
    sys.exit(0)
PY
  do
    if (( "$(date +%s)" - started > timeout )); then
      die "timeout waiting for tcp://${host}:${port}"
    fi
    sleep 2
  done
}
