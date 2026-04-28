#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "${ROOT_DIR}/scripts/scenarios/common.sh"
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

CLUSTER_REHEARSAL_NAME="cluster-rehearsal"
CLUSTER_REHEARSAL_ROOT_DEFAULT="${ROOT_DIR}/artifacts/runtime/scenario/${CLUSTER_REHEARSAL_NAME}"
CLUSTER_REHEARSAL_ROOT="${CLUSTER_REHEARSAL_ROOT:-${CLUSTER_REHEARSAL_ROOT_DEFAULT}}"
CLUSTER_REHEARSAL_RELEASES_DIR="${CLUSTER_REHEARSAL_ROOT}/releases"
CLUSTER_REHEARSAL_CURRENT_LINK="${CLUSTER_REHEARSAL_ROOT}/current"
CLUSTER_REHEARSAL_CONFIG_DIR="${CLUSTER_REHEARSAL_ROOT}/config"
CLUSTER_REHEARSAL_KIND_CONFIG_PATH="${CLUSTER_REHEARSAL_KIND_CONFIG_PATH:-${CLUSTER_REHEARSAL_CONFIG_DIR}/kind-config.yaml}"
CLUSTER_REHEARSAL_GENERATED_DIR="${CLUSTER_REHEARSAL_ROOT}/state/generated"
CLUSTER_REHEARSAL_LEGACY_SHARED_KUBECONFIG="${CLUSTER_REHEARSAL_CONFIG_DIR}/kubeconfig"
CLUSTER_REHEARSAL_LEGACY_SHARED_ADMIN_KUBECONFIG="${CLUSTER_REHEARSAL_CONFIG_DIR}/admin-kubeconfig"
CLUSTER_REHEARSAL_LEGACY_SHARED_MANAGER_KUBECONFIG="${CLUSTER_REHEARSAL_CONFIG_DIR}/manager-kubeconfig"
CLUSTER_REHEARSAL_LEGACY_SHARED_ADMIN_READY_ENV="${CLUSTER_REHEARSAL_CONFIG_DIR}/admin-ready.env"
CLUSTER_REHEARSAL_LEGACY_ADMIN_HANDOFF_DIR="${CLUSTER_REHEARSAL_ROOT}/admin-handoff"

apply_cluster_rehearsal_fast_path_env() {
  assert_rehearsal_skip_env_allowed \
    SKIP_BUNDLED_IMAGE_LOAD \
    SKIP_RELEASE_ARCHIVE \
    SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION \
    CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD \
    CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE
  [[ "${REHEARSAL_MODE}" == "fast" ]] || return 0

  if [[ -z "${SKIP_BUNDLED_IMAGE_LOAD:-}" && -n "${CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD:-}" ]]; then
    export SKIP_BUNDLED_IMAGE_LOAD="${CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD}"
  fi
  if [[ -z "${SKIP_RELEASE_ARCHIVE:-}" && -n "${CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE:-}" ]]; then
    export SKIP_RELEASE_ARCHIVE="${CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE}"
  fi
  if [[ -z "${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-}" && "${SKIP_BUNDLED_IMAGE_LOAD:-0}" == "1" ]]; then
    export SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1
  fi
}

init_cluster_rehearsal_env() {
  load_flow_env "${CLUSTER_REHEARSAL_NAME}"
  apply_cluster_rehearsal_fast_path_env
  mkdir -p "${CLUSTER_REHEARSAL_ROOT}" "${CLUSTER_REHEARSAL_RELEASES_DIR}" "${CLUSTER_REHEARSAL_CONFIG_DIR}" "${CLUSTER_REHEARSAL_GENERATED_DIR}"
  export ROOT_DIR
  export CLUSTER_DEPLOY_ROOT="${CLUSTER_REHEARSAL_ROOT}"
  export LOCAL_KIND_CONFIG_PATH="${CLUSTER_REHEARSAL_KIND_CONFIG_PATH}"
  export CLUSTER_DEPLOY_SHARED_KUBECONFIG="${CLUSTER_REHEARSAL_GENERATED_DIR}/kubeconfig"
  export CLUSTER_DEPLOY_SHARED_ADMIN_KUBECONFIG="${CLUSTER_REHEARSAL_GENERATED_DIR}/admin-kubeconfig"
  export CLUSTER_DEPLOY_SHARED_MANAGER_KUBECONFIG="${CLUSTER_REHEARSAL_GENERATED_DIR}/manager-kubeconfig"
  export CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV="${CLUSTER_REHEARSAL_GENERATED_DIR}/admin-ready.env"
  export CLUSTER_DEPLOY_ADMIN_HANDOFF_DIR="${CLUSTER_REHEARSAL_GENERATED_DIR}/admin-handoff"
  if [[ -e "${CLUSTER_REHEARSAL_CURRENT_LINK}" ]]; then
    export RELEASE_ROOT="$(cd -P "${CLUSTER_REHEARSAL_CURRENT_LINK}" && pwd)"
  else
    export RELEASE_ROOT="${ROOT_DIR}"
  fi
  export CLUSTER_DEPLOY_MODE="${CLUSTER_DEPLOY_MODE:-full-auto}"
}

render_cluster_rehearsal_kind_config() {
  local sandbox_host_port="${CLUSTER_REHEARSAL_SANDBOX_HOST_PORT:-}"
  [[ -n "${sandbox_host_port}" ]] || return 0
  render_scenario_owned_kind_config \
    "${ROOT_DIR}/infra/deploy/demo/kind/config.yaml" \
    "${CLUSTER_REHEARSAL_KIND_CONFIG_PATH}" \
    "$(scenario_kind_cluster_name)" \
    "${sandbox_host_port}"
}

cleanup_cluster_rehearsal_legacy_generated_state() {
  rm -f \
    "${CLUSTER_REHEARSAL_LEGACY_SHARED_KUBECONFIG}" \
    "${CLUSTER_REHEARSAL_LEGACY_SHARED_ADMIN_KUBECONFIG}" \
    "${CLUSTER_REHEARSAL_LEGACY_SHARED_MANAGER_KUBECONFIG}" \
    "${CLUSTER_REHEARSAL_LEGACY_SHARED_ADMIN_READY_ENV}"
  rm -rf "${CLUSTER_REHEARSAL_LEGACY_ADMIN_HANDOFF_DIR}"
}

ensure_cluster_rehearsal_registry_env() {
  local registry_host="${CLUSTER_REHEARSAL_REGISTRY_HOST:-$(scenario_kind_registry_host):$(scenario_kind_registry_host_port)}"
  local k8s_registry_host="${CLUSTER_REHEARSAL_K8S_REGISTRY_HOST:-$(scenario_kind_registry_name):5000}"
  cat > "${CLUSTER_REHEARSAL_CONFIG_DIR}/registry.env" <<EOF
REGISTRY_HOST=${registry_host}
REGISTRY_PROJECT=mbos
REGISTRY_USERNAME=
REGISTRY_PASSWORD=
K8S_REGISTRY_HOST=${k8s_registry_host}
EOF
}

ensure_cluster_rehearsal_site_env() {
  local site_env="${CLUSTER_REHEARSAL_CONFIG_DIR}/site.env"
  local example_site_env="${ROOT_DIR}/infra/deploy/cluster/env/site.env.example"
  if [[ ! -f "${site_env}" ]]; then
    if [[ -f "${ROOT_DIR}/.infra/cluster-deploy/site.env" ]]; then
      cp "${ROOT_DIR}/.infra/cluster-deploy/site.env" "${site_env}"
    else
      cp "${example_site_env}" "${site_env}"
    fi
  fi
  merge_missing_site_env_keys_from_example "${site_env}" "${example_site_env}"
  apply_flow_site_env_overrides "${site_env}"
  canonicalize_cluster_rehearsal_site_env_protocol_aliases "${site_env}"
  rewrite_cluster_rehearsal_sandbox_public_base_url "${site_env}"
  ensure_scenario_site_env_proxy_admin_token "${site_env}" "${CLUSTER_REHEARSAL_NAME}"
  ensure_scenario_site_env_proxy_data_token "${site_env}" "${CLUSTER_REHEARSAL_NAME}"
  render_cluster_rehearsal_kind_config
  validate_cluster_rehearsal_site_env "${site_env}"
}

canonicalize_cluster_rehearsal_site_env_protocol_aliases() {
  local site_env="$1"
  local anthropic_protocol
  local openai_protocol

  anthropic_protocol="$(site_env_value "${site_env}" PRESET_ANTHROPIC_ENDPOINT_PROTOCOL)"
  if [[ "${anthropic_protocol}" == "anthropic_compatible" ]]; then
    write_site_env_value "${site_env}" PRESET_ANTHROPIC_ENDPOINT_PROTOCOL anthropic_messages
  fi

  openai_protocol="$(site_env_value "${site_env}" PRESET_OPENAI_ENDPOINT_PROTOCOL)"
  if [[ "${openai_protocol}" == "openai_compatible" ]]; then
    write_site_env_value "${site_env}" PRESET_OPENAI_ENDPOINT_PROTOCOL openai_chat_completions
  fi
}

rewrite_cluster_rehearsal_sandbox_public_base_url() {
  local site_env="$1"
  local sandbox_host_port="${CLUSTER_REHEARSAL_SANDBOX_HOST_PORT:-}"
  [[ -n "${sandbox_host_port}" ]] || return 0

  python3 - <<'PY' "${site_env}" "${sandbox_host_port}"
from pathlib import Path
import sys
from urllib.parse import urlsplit, urlunsplit

path = Path(sys.argv[1])
target_port = int(sys.argv[2])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []

def rewrite_url(raw_value: str) -> str:
    value = raw_value.strip().strip('"').strip("'")
    if not value:
        return f"http://127.0.0.1:{target_port}"

    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.hostname:
        return f"http://127.0.0.1:{target_port}"

    hostname = parsed.hostname
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"

    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        auth += "@"

    netloc = f"{auth}{hostname}:{target_port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))

updated = []
seen = False
for line in lines:
    if line.startswith("SANDBOX_MANAGER_PUBLIC_BASE_URL="):
        _, value = line.split("=", 1)
        updated.append(f"SANDBOX_MANAGER_PUBLIC_BASE_URL={rewrite_url(value)}")
        seen = True
        continue
    updated.append(line)

if not seen:
    updated.append(f"SANDBOX_MANAGER_PUBLIC_BASE_URL=http://127.0.0.1:{target_port}")

path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
}

cluster_rehearsal_kind_gateway_host() {
  if [[ -n "${CLUSTER_REHEARSAL_KIND_GATEWAY_HOST:-}" ]]; then
    printf '%s\n' "${CLUSTER_REHEARSAL_KIND_GATEWAY_HOST}"
    return 0
  fi

  docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
    | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
}

rewrite_cluster_rehearsal_kind_gateway_site_env() {
  local site_env="$1"
  local gateway_host
  local postgres_port
  local minio_port
  local api_port

  gateway_host="$(cluster_rehearsal_kind_gateway_host || true)"
  [[ -n "${gateway_host}" ]] || return 0

  postgres_port="$(site_env_value "${site_env}" POSTGRES_PORT)"
  minio_port="$(site_env_value "${site_env}" MINIO_API_PORT)"
  api_port="$(site_env_value "${site_env}" API_PORT)"

  [[ -n "${postgres_port}" ]] && write_site_env_value "${site_env}" K8S_EXTERNAL_POSTGRES_PORT "${postgres_port}"
  [[ -n "${minio_port}" ]] && write_site_env_value "${site_env}" K8S_EXTERNAL_MINIO_PORT "${minio_port}"
  write_site_env_value "${site_env}" K8S_EXTERNAL_POSTGRES_HOST "${gateway_host}"
  write_site_env_value "${site_env}" K8S_EXTERNAL_MINIO_HOST "${gateway_host}"
  if [[ -n "${api_port}" ]]; then
    write_site_env_value "${site_env}" K8S_EXTERNAL_API_BASE_URL "http://${gateway_host}:${api_port}"
  fi
}

validate_cluster_rehearsal_site_env() {
  local site_env="$1"
  local anthropic_protocol
  local openai_protocol

  anthropic_protocol="$(awk -F= '$1=="PRESET_ANTHROPIC_ENDPOINT_PROTOCOL"{print $2}' "${site_env}" | tail -n1 | tr -d "\"'[:space:]")"
  openai_protocol="$(awk -F= '$1=="PRESET_OPENAI_ENDPOINT_PROTOCOL"{print $2}' "${site_env}" | tail -n1 | tr -d "\"'[:space:]")"

  if [[ -n "${anthropic_protocol}" ]]; then
    normalize_endpoint_upstream_protocol "${anthropic_protocol}" >/dev/null || return 1
  fi
  if [[ -n "${openai_protocol}" ]]; then
    normalize_endpoint_upstream_protocol "${openai_protocol}" >/dev/null || return 1
  fi
}

ensure_cluster_rehearsal_release_bundle() {
  apply_cluster_rehearsal_fast_path_env
  local release_id="cluster-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
  local skip_release_archive="${SKIP_RELEASE_ARCHIVE:-}"
  local skip_bundled_image_archive_generation="${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-}"
  OUT_DIR="${CLUSTER_REHEARSAL_RELEASES_DIR}" \
    RELEASE_ID="${release_id}" \
    SKIP_RELEASE_ARCHIVE="${skip_release_archive}" \
    SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION="${skip_bundled_image_archive_generation}" \
    bash "${ROOT_DIR}/scripts/cluster-deploy/build-bundle.sh"
  export RELEASE_ROOT="${CLUSTER_REHEARSAL_RELEASES_DIR}/agentsmith-${release_id}"
}

cluster_state_file() {
  printf '%s/state/deploy-state.json\n' "${CLUSTER_REHEARSAL_ROOT}"
}

cluster_state_value() {
  local key="$1"
  local file
  file="$(cluster_state_file)"
  [[ -f "${file}" ]] || return 0
  python3 - <<'PY' "${file}" "${key}"
import json
import pathlib
import sys

file_path = pathlib.Path(sys.argv[1])
path = [part for part in sys.argv[2].split('.') if part]
data = json.loads(file_path.read_text(encoding='utf-8'))
value = data
for part in path:
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(0)
    value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is not None:
    print(value)
PY
}

cluster_release_id() {
  local value
  value="$(cluster_state_value release.id)"
  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
    return 0
  fi
  if [[ -L "${CLUSTER_REHEARSAL_CURRENT_LINK}" || -d "${CLUSTER_REHEARSAL_CURRENT_LINK}" ]]; then
    awk -F= '$1=="release_id"{print $2}' "${CLUSTER_REHEARSAL_CURRENT_LINK}/VERSION" 2>/dev/null || true
  fi
}

cluster_site_env_path() {
  if [[ -f "${CLUSTER_REHEARSAL_ROOT}/config/site.env" ]]; then
    printf '%s\n' "${CLUSTER_REHEARSAL_ROOT}/config/site.env"
  else
    printf '%s\n' "${ROOT_DIR}/env/site.env.example"
  fi
}

cluster_env_value() {
  local key="$1"
  local path
  path="$(cluster_site_env_path)"
  python3 - <<'PY' "${path}" "${key}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
if not path.exists():
    raise SystemExit(0)
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    name, value = line.split('=', 1)
    if name.strip() == key:
        print(value.strip().strip('"').strip("'"))
        break
PY
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true
}

run_stage() {
  local stage="$1"
  bash "${ROOT_DIR}/scripts/cluster-deploy/${stage}.sh"
}

cluster_phase_value() {
  local phase
  phase="${1:-$(cluster_state_value release.phase)}"
  printf '%s\n' "${phase}"
}

cluster_phase_at_least_app_deployed() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  case "${phase}" in
    deploy_app_completed|admin_handoff_prepared|apply_cluster_prereqs_completed|deploy_sandbox_completed|bootstrap_completed|verify_completed)
      return 0
      ;;
  esac
  return 1
}

cluster_phase_at_least_bootstrapped() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  [[ "${phase}" == "bootstrap_completed" || "${phase}" == "verify_completed" ]]
}

cluster_phase_verified() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  [[ "${phase}" == "verify_completed" ]]
}

cluster_require_phase() {
  local action="$1"
  local phase
  phase="$(cluster_phase_value)"

  case "${action}" in
    bootstrap)
      if cluster_phase_at_least_app_deployed "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: bootstrap requires an environment prepared by cluster-rehearsal-up.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-up
EOF
      ;;
    verify)
      if cluster_phase_at_least_bootstrapped "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: verify requires a bootstrapped rehearsal line.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-bootstrap
EOF
      ;;
    report)
      if cluster_phase_verified "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: report requires a completed verify run.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-verify
EOF
      ;;
    *)
      echo "[cluster-rehearsal] ERROR: unsupported phase guard: ${action}" >&2
      ;;
  esac
  exit 1
}

cluster_stage_summary() {
  local phase
  phase="$(cluster_phase_value)"

  if cluster_phase_verified "${phase}"; then
    printf 'verify completed\n'
  elif cluster_phase_at_least_bootstrapped "${phase}"; then
    printf 'bootstrapped\n'
  elif cluster_phase_at_least_app_deployed "${phase}"; then
    printf 'environment ready\n'
  elif [[ -n "${phase}" ]]; then
    printf '%s\n' "${phase}"
  else
    printf 'not started\n'
  fi
}

mark_cluster_rehearsal_admin_ready() {
  local ready_env="${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV}"
  mkdir -p "$(dirname "${ready_env}")"
  cat > "${ready_env}" <<EOF
ADMIN_READY=1
ADMIN_CHECKED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

cluster_rehearsal_valid_sha256_digest() {
  [[ "${1:-}" =~ ^sha256:[a-f0-9]{64}$ ]]
}

cluster_rehearsal_image_repo_from_ref() {
  local ref="${1%%@*}"
  local last_component="${ref##*/}"

  if [[ "${last_component}" == *:* ]]; then
    ref="${ref%:*}"
  fi

  printf '%s\n' "${ref}"
}

cluster_rehearsal_digest_from_ref() {
  local digest="${1##*@}"

  if [[ "${digest}" != "$1" ]] && cluster_rehearsal_valid_sha256_digest "${digest}"; then
    printf '%s\n' "${digest}"
    return 0
  fi

  return 1
}

cluster_rehearsal_local_image_manifest_digest_from_inspect() {
  local image_ref="$1"
  shift

  local repo_digests_json
  repo_digests_json="$(docker image inspect --format '{{json .RepoDigests}}' "${image_ref}" 2>/dev/null)" || return 1

  python3 - "${repo_digests_json}" "$@" <<'PY'
import json
import re
import sys

digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")
expected_repos = set(sys.argv[2:])

try:
    repo_digests = json.loads(sys.argv[1])
except json.JSONDecodeError:
    raise SystemExit(1)

if not isinstance(repo_digests, list):
    raise SystemExit(1)

digests = set()
for entry in repo_digests:
    if not isinstance(entry, str) or "@" not in entry:
        continue
    repo, digest = entry.rsplit("@", 1)
    if repo not in expected_repos:
        continue
    if digest_pattern.fullmatch(digest):
        digests.add(digest)

if len(digests) != 1:
    raise SystemExit(1)

print(next(iter(digests)))
PY
}

cluster_rehearsal_local_image_manifest_digest() {
  local host_image="$1"
  local kind_image="$2"
  local host_repo
  local kind_repo
  local digest

  digest="$(cluster_rehearsal_digest_from_ref "${kind_image}" || true)"
  if [[ -n "${digest}" ]] && docker image inspect "${kind_image}" >/dev/null 2>&1; then
    printf '%s\n' "${digest}"
    return 0
  fi

  host_repo="$(cluster_rehearsal_image_repo_from_ref "${host_image}")"
  kind_repo="$(cluster_rehearsal_image_repo_from_ref "${kind_image}")"

  digest="$(cluster_rehearsal_local_image_manifest_digest_from_inspect "${kind_image}" "${kind_repo}" "${host_repo}" || true)"
  if cluster_rehearsal_valid_sha256_digest "${digest}"; then
    printf '%s\n' "${digest}"
    return 0
  fi

  if [[ "${host_image}" != "${kind_image}" ]]; then
    digest="$(cluster_rehearsal_local_image_manifest_digest_from_inspect "${host_image}" "${host_repo}" || true)"
    if cluster_rehearsal_valid_sha256_digest "${digest}"; then
      printf '%s\n' "${digest}"
      return 0
    fi
  fi

  return 1
}

cluster_rehearsal_kind_containerd_image_digest() {
  local cluster_name="$1"
  local kind_image="$2"
  local inspect_json

  inspect_json="$(docker exec "${cluster_name}-control-plane" ctr -n k8s.io images inspect "${kind_image}" 2>/dev/null)" || return 1

  python3 - "${inspect_json}" <<'PY'
import json
import re
import sys

digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")

try:
    image = json.loads(sys.argv[1])
except json.JSONDecodeError:
    raise SystemExit(1)

if not isinstance(image, dict):
    raise SystemExit(1)

target = image.get("target")
if not isinstance(target, dict):
    target = image.get("Target")
if not isinstance(target, dict):
    raise SystemExit(1)

digest = target.get("digest")
if not isinstance(digest, str):
    digest = target.get("Digest")
if not isinstance(digest, str) or not digest_pattern.fullmatch(digest):
    raise SystemExit(1)

print(digest)
PY
}

cluster_rehearsal_append_kind_preload_skip_decision() {
  local kind_image="$1"
  local input_digest="$2"
  local existing_artifact_digest="$3"
  local skip_decision_path="${RELEASE_ROOT}/skip-decisions.ndjson"
  local generated_at

  mkdir -p "$(dirname "${skip_decision_path}")"
  generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  python3 - "${skip_decision_path}" "${kind_image}" "${input_digest}" "${existing_artifact_digest}" "${generated_at}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "schema": "current-build-skip-decision.v1",
    "version": 1,
    "target": f"image:{sys.argv[2]}",
    "operation": "kind_preload",
    "input_digest": sys.argv[3],
    "existing_artifact_digest": sys.argv[4],
    "skip_reason": "kind_containerd_target_digest_matches_local_manifest_digest",
    "validator": "local docker image inspect RepoDigests and kind containerd ctr images inspect target digest",
    "generated_at": sys.argv[5],
}

with path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
PY
}

cluster_rehearsal_kind_preload_digest_match() {
  local cluster_name="$1"
  local host_image="$2"
  local kind_image="$3"
  local local_digest
  local kind_digest

  CLUSTER_REHEARSAL_KIND_PRELOAD_LOCAL_DIGEST=""
  CLUSTER_REHEARSAL_KIND_PRELOAD_EXISTING_DIGEST=""

  [[ "${FORCE_KIND_PRELOAD:-0}" != "1" ]] || return 1

  local_digest="$(cluster_rehearsal_local_image_manifest_digest "${host_image}" "${kind_image}" || true)"
  cluster_rehearsal_valid_sha256_digest "${local_digest}" || return 1

  kind_digest="$(cluster_rehearsal_kind_containerd_image_digest "${cluster_name}" "${kind_image}" || true)"
  cluster_rehearsal_valid_sha256_digest "${kind_digest}" || return 1

  [[ "${local_digest}" == "${kind_digest}" ]] || return 1

  CLUSTER_REHEARSAL_KIND_PRELOAD_LOCAL_DIGEST="${local_digest}"
  CLUSTER_REHEARSAL_KIND_PRELOAD_EXISTING_DIGEST="${kind_digest}"
  return 0
}

cluster_rehearsal_import_kind_image() {
  local cluster_name="$1"
  local kind_image="$2"
  local tarball
  local status

  if tarball="$(mktemp /tmp/cluster-rehearsal-kind-image.XXXXXX.tar)"; then
    :
  else
    status=$?
    return "${status}"
  fi

  if docker save --platform linux/amd64 "${kind_image}" -o "${tarball}"; then
    :
  else
    status=$?
    rm -f "${tarball}" || true
    return "${status}"
  fi

  if cat "${tarball}" | docker exec -i "${cluster_name}-control-plane" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar' >/dev/null; then
    :
  else
    status=$?
    rm -f "${tarball}" || true
    return "${status}"
  fi

  rm -f "${tarball}"
}

preload_cluster_rehearsal_kind_images() {
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
  ensure_dirs
  ensure_operator_registry_env
  load_registry_env
  require_version_images

  local cluster_name
  cluster_name="$(scenario_kind_cluster_name)"
  local host_images=(
    "${RUNNER_IMAGE}"
    "${CHAT_RUNNER_IMAGE}"
    "${SANDBOX_MANAGER_IMAGE}"
    "${JUICEFS_MOUNT_IMAGE}"
    "${JUICEFS_CSI_DRIVER_IMAGE}"
    "${JUICEFS_CSI_DASHBOARD_IMAGE}"
    "${JUICEFS_CSI_PROVISIONER_IMAGE}"
    "${JUICEFS_CSI_RESIZER_IMAGE}"
    "${JUICEFS_CSI_LIVENESSPROBE_IMAGE}"
    "${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
    "${INGRESS_NGINX_CONTROLLER_IMAGE}"
    "${INGRESS_NGINX_CERTGEN_IMAGE}"
  )
  local kind_images=(
    "${K8S_RUNNER_IMAGE}"
    "${K8S_CHAT_RUNNER_IMAGE}"
    "${K8S_SANDBOX_MANAGER_IMAGE}"
    "${K8S_JUICEFS_MOUNT_IMAGE}"
    "${K8S_JUICEFS_CSI_DRIVER_IMAGE}"
    "${K8S_JUICEFS_CSI_DASHBOARD_IMAGE}"
    "${K8S_JUICEFS_CSI_PROVISIONER_IMAGE}"
    "${K8S_JUICEFS_CSI_RESIZER_IMAGE}"
    "${K8S_JUICEFS_CSI_LIVENESSPROBE_IMAGE}"
    "${K8S_JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
    "${K8S_INGRESS_NGINX_CONTROLLER_IMAGE}"
    "${K8S_INGRESS_NGINX_CERTGEN_IMAGE}"
  )

  local idx host_image kind_image
  for idx in "${!kind_images[@]}"; do
    host_image="${host_images[$idx]}"
    kind_image="${kind_images[$idx]}"
    [[ -n "${host_image}" && -n "${kind_image}" ]] || continue
    if [[ "${host_image}" != "${kind_image}" ]]; then
      docker tag "${host_image}" "${kind_image}" >/dev/null
    fi
    if cluster_rehearsal_kind_preload_digest_match "${cluster_name}" "${host_image}" "${kind_image}"; then
      cluster_rehearsal_append_kind_preload_skip_decision \
        "${kind_image}" \
        "${CLUSTER_REHEARSAL_KIND_PRELOAD_LOCAL_DIGEST}" \
        "${CLUSTER_REHEARSAL_KIND_PRELOAD_EXISTING_DIGEST}"
      continue
    fi
    cluster_rehearsal_import_kind_image "${cluster_name}" "${kind_image}"
  done
}
