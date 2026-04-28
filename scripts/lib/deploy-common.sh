#!/usr/bin/env bash
set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT_DEFAULT="${DEPLOY_ROOT_DEFAULT:-${HOME}/agentsmith/deploy}"
DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-deploy}"

log() { printf '[%s] %s\n' "${DEPLOY_LOG_PREFIX}" "$*"; }
die() { printf '[%s] ERROR: %s\n' "${DEPLOY_LOG_PREFIX}" "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

infer_release_root_from_common_dir() {
  local candidate
  candidate="$(cd "${COMMON_DIR}/../.." && pwd)"
  if [[ -f "${candidate}/VERSION" ]]; then
    cd -P "${candidate}" && pwd
  fi
}

infer_deploy_root_from_release_root() {
  local candidate="$1"
  local parent
  parent="$(basename "$(dirname "${candidate}")")"
  if [[ "$(basename "${candidate}")" == "current" ]]; then
    dirname "${candidate}"
    return 0
  fi
  if [[ "${parent}" == "releases" ]]; then
    dirname "$(dirname "${candidate}")"
    return 0
  fi
  return 1
}

ensure_release_id_default() {
  if [[ -z "${RELEASE_ID:-}" ]]; then
    RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
  fi
}

read_version_release_id() {
  local version_path="$1"
  awk -F= '$1=="release_id"{print $2; exit}' "${version_path}" 2>/dev/null || true
}

die_missing_version_release_id() {
  die "VERSION is missing release_id; refusing to use incomplete release truth"
}

die_release_id_mismatch() {
  die "RELEASE_ID does not match VERSION release_id; refusing to use mismatched release truth"
}

require_version_release_id() {
  local version_path="$1"
  local version_release_id=""
  version_release_id="$(read_version_release_id "${version_path}")"
  [[ -n "${version_release_id}" ]] || die_missing_version_release_id
  printf '%s\n' "${version_release_id}"
}

INFERRED_RELEASE_ROOT="$(infer_release_root_from_common_dir || true)"
INFERRED_DEPLOY_ROOT=""
if [[ -n "${INFERRED_RELEASE_ROOT}" ]]; then
  INFERRED_DEPLOY_ROOT="$(infer_deploy_root_from_release_root "${INFERRED_RELEASE_ROOT}" || true)"
fi

DEPLOY_ROOT="${DEPLOY_ROOT:-${DEMO_DEPLOY_ROOT:-${CLUSTER_DEPLOY_ROOT:-${INFERRED_DEPLOY_ROOT:-${DEPLOY_ROOT_DEFAULT}}}}}"
CURRENT_LINK="${DEPLOY_ROOT}/current"
EXPLICIT_RELEASE_ID="${RELEASE_ID:-}"
RELEASE_ID="${EXPLICIT_RELEASE_ID}"
if [[ -z "${RELEASE_ROOT:-}" ]]; then
  if [[ -n "${INFERRED_RELEASE_ROOT}" ]]; then
    RELEASE_ROOT="${INFERRED_RELEASE_ROOT}"
  elif [[ "${DEPLOY_COMMON_IGNORE_CURRENT_RELEASE:-0}" != "1" && -f "${CURRENT_LINK}/VERSION" ]]; then
    RELEASE_ROOT="$(readlink -f "${CURRENT_LINK}")"
  else
    ensure_release_id_default
    RELEASE_ROOT="${DEPLOY_ROOT}/releases/${RELEASE_ID}"
  fi
elif [[ -e "${RELEASE_ROOT}" ]]; then
  RELEASE_ROOT="$(cd -P "${RELEASE_ROOT}" && pwd)"
fi
if [[ -d "${RELEASE_ROOT}/scripts/lib" ]]; then
  RELEASE_SCRIPT_DIR="${RELEASE_ROOT}/scripts"
else
  RELEASE_SCRIPT_DIR="${RELEASE_ROOT}/scripts/demo-deploy"
fi
STATE_DIR="${DEPLOY_ROOT}/state"
LOG_DIR="${DEPLOY_ROOT}/logs"
REPORT_DIR="${DEPLOY_ROOT}/reports"
CONFIG_DIR="${DEPLOY_ROOT}/config"
SHARED_SITE_ENV="${CONFIG_DIR}/site.env"
TOOLS_DIR="${RELEASE_ROOT}/tools"
if [[ -f "${RELEASE_ROOT}/VERSION" ]]; then
  VERSION_RELEASE_ID="$(require_version_release_id "${RELEASE_ROOT}/VERSION")"
  if [[ -n "${EXPLICIT_RELEASE_ID}" && "${EXPLICIT_RELEASE_ID}" != "${VERSION_RELEASE_ID}" ]]; then
    die_release_id_mismatch
  fi
  RELEASE_ID="${VERSION_RELEASE_ID}"
fi
ensure_release_id_default
export DEPLOY_ROOT CURRENT_LINK RELEASE_ID RELEASE_ROOT RELEASE_SCRIPT_DIR STATE_DIR LOG_DIR REPORT_DIR CONFIG_DIR SHARED_SITE_ENV TOOLS_DIR
ORIGINAL_PATH="${PATH}"
resolve_tool() {
  local bundled="$1"
  local system_name="$2"
  shift 2
  if [[ -x "${bundled}" ]] && "${bundled}" "$@" >/dev/null 2>&1; then
    printf '%s\n' "${bundled}"
    return 0
  fi
  PATH="${ORIGINAL_PATH}" type -P "${system_name}"
}

KIND_BIN="$(resolve_tool "${TOOLS_DIR}/kind" kind --version || true)"
KUBECTL_BIN="$(resolve_tool "${TOOLS_DIR}/kubectl" kubectl version --client)"

kind() { "${KIND_BIN}" "$@"; }
kubectl() { "${KUBECTL_BIN}" "$@"; }

image_tar_name() {
  printf '%s' "$1" | tr '/:@' '---'
}

bundled_image_archive_path() {
  local image="$1"
  local archive_path="${RELEASE_ROOT}/images/$(image_tar_name "${image}").tar"
  if [[ -f "${archive_path}" ]]; then
    printf '%s\n' "${archive_path}"
  fi
}

docker_load_skip_decision_generated_at() {
  if [[ -n "${BUILD_ARTIFACT_BROKER_GENERATED_AT:-}" ]]; then
    printf '%s' "${BUILD_ARTIFACT_BROKER_GENERATED_AT}"
    return 0
  fi

  node -e 'process.stdout.write(new Date().toISOString())'
}

append_docker_load_skip_decision() {
  local image_ref="$1"
  local archive_config_digest="$2"
  local local_image_id="$3"
  local generated_at
  local skip_decisions_path="${RELEASE_ROOT}/skip-decisions.ndjson"

  generated_at="$(docker_load_skip_decision_generated_at)"
  node - \
    "${skip_decisions_path}" \
    "${image_ref}" \
    "${archive_config_digest}" \
    "${local_image_id}" \
    "${generated_at}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [skipDecisionsPath, imageRef, archiveConfigDigest, localImageId, generatedAt] = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const imageRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u;

if (!imageRefPattern.test(imageRef) || !digestPattern.test(archiveConfigDigest) || !digestPattern.test(localImageId)) {
  process.exit(1);
}

const decision = {
  schema: 'current-build-skip-decision.v1',
  version: 1,
  target: `image:${imageRef}`,
  operation: 'docker_load',
  input_digest: archiveConfigDigest,
  existing_artifact_digest: localImageId,
  skip_reason: 'local_docker_image_config_digest_matches_archive_config_digest',
  validator: 'docker save archive manifest Config digest and docker image inspect --format {{.Id}}',
  generated_at: generatedAt,
};

fs.mkdirSync(path.dirname(skipDecisionsPath), { recursive: true });
fs.appendFileSync(skipDecisionsPath, `${JSON.stringify(decision)}\n`, 'utf8');
NODE
}

docker_load_archive_config_proof() {
  local archive_path="$1"

  command -v node >/dev/null 2>&1 || return 1
  command -v tar >/dev/null 2>&1 || return 1

  node - "${archive_path}" <<'NODE'
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const archivePath = process.argv[2];
const imageRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeArchivePath(value) {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.startsWith('-')) {
    return false;
  }

  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function readArchiveEntry(entryPath, encoding) {
  return execFileSync('tar', ['-xOf', archivePath, entryPath], {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
}

try {
  const manifest = JSON.parse(readArchiveEntry('manifest.json', 'utf8'));
  if (!Array.isArray(manifest) || manifest.length !== 1) {
    process.exit(1);
  }

  const entry = manifest[0];
  if (!isRecord(entry) || !Array.isArray(entry.RepoTags) || entry.RepoTags.length !== 1) {
    process.exit(1);
  }

  const [imageRef] = entry.RepoTags;
  if (typeof imageRef !== 'string' || !imageRefPattern.test(imageRef)) {
    process.exit(1);
  }
  if (!isSafeArchivePath(entry.Config)) {
    process.exit(1);
  }

  const configBytes = readArchiveEntry(entry.Config, null);
  JSON.parse(configBytes.toString('utf8'));
  const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  process.stdout.write(`${imageRef}\t${configDigest}`);
} catch {
  process.exit(1);
}
NODE
}

local_docker_image_config_digest() {
  local image_ref="$1"
  local image_id

  if ! image_id="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null)"; then
    return 1
  fi
  [[ "${image_id}" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '%s\n' "${image_id}"
}

docker_load_archive_with_digest_proven_skip() {
  local archive_path="$1"
  local proof=""
  local image_ref=""
  local archive_config_digest=""
  local local_image_id=""

  if proof="$(docker_load_archive_config_proof "${archive_path}")"; then
    IFS=$'\t' read -r image_ref archive_config_digest <<< "${proof}"
    if [[ -n "${image_ref}" && -n "${archive_config_digest}" ]] \
      && local_image_id="$(local_docker_image_config_digest "${image_ref}")" \
      && [[ "${local_image_id}" == "${archive_config_digest}" ]] \
      && append_docker_load_skip_decision "${image_ref}" "${archive_config_digest}" "${local_image_id}"; then
      log "skipping docker load because local Docker image config digest matches archive config digest: ${image_ref}"
      return 0
    fi
  fi

  log "loading $(basename "${archive_path}")"
  docker load -i "${archive_path}" >/dev/null
}

ensure_local_image_from_bundle() {
  local image="$1"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    return 0
  fi
  local archive_path
  archive_path="$(bundled_image_archive_path "${image}")"
  [[ -n "${archive_path}" ]] || die "missing bundled image archive for ${image}"
  docker load -i "${archive_path}" >/dev/null
}

ensure_dirs() {
  mkdir -p "${DEPLOY_ROOT}" "${STATE_DIR}" "${LOG_DIR}" "${REPORT_DIR}" "${CONFIG_DIR}"
}

ensure_operator_site_env() {
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"

  if [[ ! -f "${SHARED_SITE_ENV}" ]]; then
    if [[ -f "${CURRENT_LINK}/env/site.env" ]]; then
      cp "${CURRENT_LINK}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env" ]]; then
      cp "${RELEASE_ROOT}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env.example" ]]; then
      cp "${RELEASE_ROOT}/env/site.env.example" "${SHARED_SITE_ENV}"
    else
      die "missing site.env and site.env.example"
    fi
  fi

  cp "${SHARED_SITE_ENV}" "${RELEASE_ROOT}/env/site.env"
}

load_release_env() {
  local env_file
  ensure_operator_site_env
  for env_file in \
    "${RELEASE_ROOT}/env/site.env" \
    "${RELEASE_ROOT}/env/base.env" \
    "${RELEASE_ROOT}/env/keycloak.env" \
    "${RELEASE_ROOT}/env/api.env" \
    "${RELEASE_ROOT}/env/web.env" \
    "${RELEASE_ROOT}/env/internal.env" \
    "${RELEASE_ROOT}/env/runner.env"; do
    if [[ -f "${env_file}" ]]; then
      load_env_file "${env_file}"
    fi
  done
}

load_env_file() {
  local env_file="$1"
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* || "${line}" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    if [[ "${value}" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "${value}" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    if [[ "${key}" == "RELEASE_ID" ]]; then
      if [[ -n "${value}" ]]; then
        assert_release_id_matches_version "${value}"
      fi
      if [[ -f "${RELEASE_ROOT}/VERSION" ]]; then
        RELEASE_ID="$(require_version_release_id "${RELEASE_ROOT}/VERSION")"
        export RELEASE_ID
      fi
      continue
    fi
    export "${key}=${value}"
  done < "${env_file}"
}

load_site_env() {
  ensure_operator_site_env
  load_env_file "${RELEASE_ROOT}/env/site.env"
}

state_file() { printf '%s/deploy-state.json\n' "${STATE_DIR}"; }

assert_release_id_matches_version() {
  local release_id="$1"
  local version_release_id=""
  if [[ -f "${RELEASE_ROOT}/VERSION" ]]; then
    version_release_id="$(require_version_release_id "${RELEASE_ROOT}/VERSION")"
  fi
  if [[ -n "${version_release_id}" && "${release_id}" != "${version_release_id}" ]]; then
    die_release_id_mismatch
  fi
}

assert_state_release_id_matches_version() {
  local state_release_id=""
  state_release_id="$(state_get release.id 2>/dev/null || true)"
  if [[ -n "${state_release_id}" ]]; then
    assert_release_id_matches_version "${state_release_id}"
  fi
}

ensure_state() {
  ensure_dirs
  if [[ ! -f "$(state_file)" ]]; then
    printf '{}\n' > "$(state_file)"
  fi
}

state_set() {
  local key="$1"
  local value="${2-}"
  if [[ "${key}" == "release.id" ]]; then
    assert_release_id_matches_version "${value}"
  fi
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

merge_no_proxy_entries() {
  python3 - "$@" <<'PY'
import sys

seen = set()
result = []
for raw in sys.argv[1:]:
    if not raw:
        continue
    for part in raw.split(','):
        item = part.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
print(','.join(result))
PY
}

no_proxy_hosts_from_inputs() {
  python3 - "$@" <<'PY'
import sys
from urllib.parse import urlparse

seen = set()
result = []

def add(value: str) -> None:
    value = value.strip()
    if not value or value in seen:
        return
    seen.add(value)
    result.append(value)

for raw in sys.argv[1:]:
    if not raw:
        continue
    for part in raw.split(','):
        item = part.strip()
        if not item:
            continue
        add(item)
        parsed = urlparse(item)
        if parsed.scheme and parsed.hostname:
            add(parsed.hostname)

print(','.join(result))
PY
}

compose_runtime_no_proxy() {
  merge_no_proxy_entries \
    "${RUNTIME_ADDITIONAL_NO_PROXY:-}" \
    "${NO_PROXY:-${no_proxy:-}}" \
    "postgres,mongo,redis,minio,keycloak,api,web,external-runner,universal-proxy,host.docker.internal,postgres-external,minio-external,sandbox-manager" \
    "$(no_proxy_hosts_from_inputs "$@")"
}

runtime_proxy_mode() {
  local mode="${RUNTIME_PROXY_MODE:-sanitized}"
  case "${mode}" in
    sanitized|inherit|custom)
      printf '%s\n' "${mode}"
      ;;
    *)
      die "invalid RUNTIME_PROXY_MODE: ${mode} (expected sanitized, inherit, or custom)"
      ;;
  esac
}

runtime_proxy_env_names() {
  cat <<'EOF'
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
http_proxy
https_proxy
all_proxy
EOF
}

runtime_proxy_value_from_pair() {
  local uppercase_key="$1"
  local lowercase_key="$2"
  local uppercase_value="${!uppercase_key-}"
  local lowercase_value="${!lowercase_key-}"

  if [[ -n "${uppercase_value}" ]]; then
    printf '%s\n' "${uppercase_value}"
  else
    printf '%s\n' "${lowercase_value}"
  fi
}

runtime_proxy_custom_value() {
  local key="$1"
  case "${key}" in
    HTTP_PROXY|http_proxy)
      printf '%s\n' "${RUNTIME_HTTP_PROXY:-}"
      ;;
    HTTPS_PROXY|https_proxy)
      printf '%s\n' "${RUNTIME_HTTPS_PROXY:-}"
      ;;
    ALL_PROXY|all_proxy)
      printf '%s\n' "${RUNTIME_ALL_PROXY:-}"
      ;;
    *)
      die "unsupported runtime proxy env key: ${key}"
      ;;
  esac
}

runtime_proxy_env_value() {
  local key="$1"
  local mode
  mode="$(runtime_proxy_mode)"

  case "${mode}" in
    sanitized)
      printf '%s\n' ""
      ;;
    inherit)
      case "${key}" in
        HTTP_PROXY|http_proxy)
          runtime_proxy_value_from_pair HTTP_PROXY http_proxy
          ;;
        HTTPS_PROXY|https_proxy)
          runtime_proxy_value_from_pair HTTPS_PROXY https_proxy
          ;;
        ALL_PROXY|all_proxy)
          runtime_proxy_value_from_pair ALL_PROXY all_proxy
          ;;
        *)
          die "unsupported runtime proxy env key: ${key}"
          ;;
      esac
      ;;
    custom)
      runtime_proxy_custom_value "${key}"
      ;;
  esac
}

compose_runtime_proxy_env() {
  local runtime_proxy_key runtime_proxy_value
  while IFS= read -r runtime_proxy_key; do
    [[ -n "${runtime_proxy_key}" ]] || continue
    runtime_proxy_value="$(runtime_proxy_env_value "${runtime_proxy_key}")"
    printf '%s=%s\n' "${runtime_proxy_key}" "${runtime_proxy_value}"
  done < <(runtime_proxy_env_names)
}

compose_runtime_proxy_sanitization_env() {
  compose_runtime_proxy_env
}

runtime_proxy_env_fingerprint_from_lines() {
  python3 - "$@" <<'PY'
import hashlib
import json
import sys

payload = {}
for raw in sys.argv[1:]:
    if "=" not in raw:
        continue
    key, value = raw.split("=", 1)
    payload[key] = value

fingerprint = hashlib.sha256(
    json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
).hexdigest()
print(fingerprint)
PY
}

runtime_proxy_env_fingerprint() {
  local -a runtime_proxy_lines=()
  mapfile -t runtime_proxy_lines < <(compose_runtime_proxy_env)
  runtime_proxy_env_fingerprint_from_lines "${runtime_proxy_lines[@]}"
}

docker_run_runtime_proxy_env_args() {
  local runtime_env
  while IFS= read -r runtime_env; do
    [[ -n "${runtime_env}" ]] || continue
    printf '%s\n' -e "${runtime_env}"
  done < <(compose_runtime_proxy_env)
}

write_compose_env() {
  local app_image="${1:-}"
  local runner_image="${2:-}"
  local universal_proxy_image="${3:-}"
  mkdir -p "${RELEASE_ROOT}/compose"
  cat > "${RELEASE_ROOT}/compose/.env" <<EOF
AGENTSMITH_APP_IMAGE=${app_image}
AGENTSMITH_RUNNER_IMAGE=${runner_image}
LLM_UNIVERSAL_PROXY_IMAGE=${universal_proxy_image}
POSTGRES_USER=${POSTGRES_USER:-mbos}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-mbos_dev_password}
POSTGRES_DB=${POSTGRES_DB:-mbos}
POSTGRES_PORT=${POSTGRES_PORT:-15432}
MONGO_ROOT_USERNAME=${MONGO_ROOT_USERNAME:-mbos}
MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD:-mbos_dev_password}
MONGO_DB=${MONGO_DB:-mbos}
MONGO_PORT=${MONGO_PORT:-17017}
REDIS_PORT=${REDIS_PORT:-16379}
MINIO_ROOT_USER=${MINIO_ROOT_USER:-mbos}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:-mbos_dev_password}
MINIO_BUCKET=${MINIO_BUCKET:-mbos-dev}
MINIO_API_PORT=${MINIO_API_PORT:-19000}
MINIO_CONSOLE_PORT=${MINIO_CONSOLE_PORT:-19001}
KEYCLOAK_ADMIN=${KEYCLOAK_ADMIN:-admin}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:-admin}
KEYCLOAK_DB=${KEYCLOAK_DB:-keycloak}
KEYCLOAK_PORT=${KEYCLOAK_PORT:-18080}
PUBLIC_KEYCLOAK_BASE_URL=${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}
API_PORT=${API_PORT:-20000}
WEB_PORT=${WEB_PORT:-3001}
EXTERNAL_DEPS_NETWORK_NAME=${EXTERNAL_DEPS_NETWORK_NAME:-agentsmith-demo-deps}
EXTERNAL_DEPS_NETWORK_SUBNET=${EXTERNAL_DEPS_NETWORK_SUBNET:-172.29.0.0/24}
EXTERNAL_DEPS_POSTGRES_IP=${EXTERNAL_DEPS_POSTGRES_IP:-172.29.0.10}
EXTERNAL_DEPS_MINIO_IP=${EXTERNAL_DEPS_MINIO_IP:-172.29.0.11}
EOF
}

detect_kind_gateway_ip() {
  local gateway
  gateway="$(
    docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
      | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
  )"
  if [[ -n "${gateway}" ]]; then
    printf '%s\n' "${gateway}"
  else
    return 1
  fi
}

kind_gateway_ip() {
  detect_kind_gateway_ip || die "unable to resolve kind gateway ip"
}

wait_http() {
  local url="$1"
  local timeout="${2:-180}"
  local started
  local target_host
  local request_no_proxy
  started="$(date +%s)"
  target_host="$(python3 - "$url" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
print(parsed.hostname or "")
PY
)"
  request_no_proxy="$(merge_no_proxy_entries "${NO_PROXY:-${no_proxy:-}}" "${target_host}")"
  until NO_PROXY="${request_no_proxy}" no_proxy="${request_no_proxy}" curl -fsS "${url}" >/dev/null 2>&1; do
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

json_extract() {
  local path="$1"
  python3 -c '
import json
import sys

path = [part for part in sys.argv[1].split(".") if part]
data = json.load(sys.stdin)
value = data
for part in path:
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
    if value is None:
        break
if value is None:
    sys.exit(2)
if isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
' "$path"
}

json_find_named_id() {
  local item_name="$1"
  python3 -c '
import json
import sys

item_name = sys.argv[1]
data = json.load(sys.stdin)
for item in data.get("items", []) or []:
    if item.get("name") == item_name:
        print(item.get("id", ""))
        break
' "${item_name}"
}

json_count_items_by_field() {
  local field_name="$1"
  local expected_value="$2"
  python3 -c '
import json
import sys

field_name = sys.argv[1]
expected_value = sys.argv[2]
data = json.load(sys.stdin)
count = 0
for item in data.get("items", []) or []:
    value = item.get(field_name)
    if value is None:
        continue
    if str(value) == expected_value:
        count += 1
print(count)
' "${field_name}" "${expected_value}"
}
