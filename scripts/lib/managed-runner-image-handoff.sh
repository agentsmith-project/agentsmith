#!/usr/bin/env bash

managed_runner_image_handoff_is_digest_ref() {
  local image="${1:-}"
  [[ "${image}" =~ @sha256:[a-fA-F0-9]{64}$ ]]
}

managed_runner_image_handoff_is_legacy_runner_image_ref() {
  local image="${1:-}"
  [[ "${image}" == *agentsmith-agent-task-runner* ]]
}

managed_runner_image_handoff_reject_legacy_runner_image_ref() {
  local image="${1:-}"
  local log_prefix="${2:-[managed-runner-image-handoff]}"
  if managed_runner_image_handoff_is_legacy_runner_image_ref "${image}"; then
    echo "${log_prefix} internal managed runner image must not reference old agent-task-runner image/path: ${image}" >&2
    return 1
  fi
}

managed_runner_image_handoff_tag_text() {
  local raw="${1:-local}"
  local tag
  tag="$(printf '%s' "${raw}" | tr -c 'A-Za-z0-9_.-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g' | cut -c1-80)"
  printf '%s\n' "${tag:-local}"
}

managed_runner_image_handoff_source_kind_bootstrap() {
  local root_dir="${1:-$(pwd)}"
  local log_prefix="${2:-[managed-runner-image-handoff]}"

  if declare -F kind_configure_registry_no_proxy_for_containerd >/dev/null 2>&1; then
    return 0
  fi

  local bootstrap_path="${root_dir}/scripts/lib/kind-cluster-bootstrap.sh"
  if [[ ! -f "${bootstrap_path}" ]]; then
    echo "${log_prefix} missing kind bootstrap helper: ${bootstrap_path}" >&2
    return 1
  fi

  # shellcheck disable=SC1090
  source "${bootstrap_path}"
}

managed_runner_image_handoff_publish_local_runner_image_ref() {
  local source_image="$1"
  local image_repository="$2"
  local image_tag="$3"
  local log_prefix="${4:-[managed-runner-image-handoff]}"
  local registry_host registry_host_port registry_container_port host_ref cluster_repo push_output manifest_raw digest digest_status

  registry_host="$(scenario_kind_registry_host)"
  registry_host_port="$(scenario_kind_registry_host_port)"
  registry_container_port="${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-5000}"
  host_ref="${registry_host}:${registry_host_port}/${image_repository}:${image_tag}"
  cluster_repo="$(scenario_kind_registry_name):${registry_container_port}/${image_repository}"

  echo "${log_prefix} publishing managed runner image to local kind registry" >&2
  docker tag "${source_image}" "${host_ref}"
  if ! push_output="$(docker push "${host_ref}" 2>&1)"; then
    echo "${log_prefix} failed to push managed runner image to local registry: ${host_ref}" >&2
    printf '%s\n' "${push_output}" >&2
    return 1
  fi

  if ! manifest_raw="$(docker buildx imagetools inspect --raw "${host_ref}" 2>&1)"; then
    echo "${log_prefix} failed to inspect pushed managed runner image manifest: ${host_ref}" >&2
    printf '%s\n' "${manifest_raw}" >&2
    return 1
  fi

  digest_status=0
  digest="$(
    MANIFEST_RAW="${manifest_raw}" python3 - "${host_ref}" <<'PY'
import hashlib
import json
import os
import re
import sys

image_ref = sys.argv[1]
raw = os.environ.get("MANIFEST_RAW", "")
digest_pattern = re.compile(r"^sha256:[a-fA-F0-9]{64}$")

try:
    payload = json.loads(raw)
except json.JSONDecodeError as exc:
    print(f"[managed-runner-image-handoff] invalid raw manifest JSON for {image_ref}: {exc}", file=sys.stderr)
    sys.exit(1)

manifests = payload.get("manifests")
if isinstance(manifests, list):
    for descriptor in manifests:
        if not isinstance(descriptor, dict):
            continue
        platform = descriptor.get("platform")
        if not isinstance(platform, dict):
            continue
        if platform.get("os") != "linux" or platform.get("architecture") != "amd64":
            continue
        digest = descriptor.get("digest")
        if isinstance(digest, str) and digest_pattern.match(digest):
            print(digest.lower())
            sys.exit(0)
    sys.exit(2)

media_type = payload.get("mediaType")
is_single_manifest = (
    payload.get("schemaVersion") == 2
    and isinstance(payload.get("config"), dict)
    and (
        not isinstance(media_type, str)
        or media_type in {
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.v2+json",
        }
    )
)
if is_single_manifest:
    print(f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}")
    sys.exit(0)

sys.exit(3)
PY
  )" || digest_status=$?
  if [[ "${digest_status}" -ne 0 || ! "${digest}" =~ ^sha256:[a-fA-F0-9]{64}$ ]]; then
    echo "${log_prefix} could not resolve linux/amd64 manifest digest for managed runner image after push: ${host_ref}" >&2
    echo "${log_prefix} docker push reported only registry upload status; image identity must come from docker buildx imagetools inspect --raw." >&2
    return 1
  fi

  printf '%s@%s\n' "${cluster_repo}" "${digest}"
}

managed_runner_image_handoff_from_kind_registry() {
  local image="$1"
  local registry_container_port="${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-5000}"
  [[ "${image}" == "$(scenario_kind_registry_name):${registry_container_port}/"* ]]
}

managed_runner_image_handoff_preflight_kind_registry_runner_image() {
  local runner_image="$1"
  local node_name="$2"
  local log_prefix="${3:-[managed-runner-image-handoff]}"
  local root_dir="${4:-$(pwd)}"
  local registry_name registry_container_port pull_output

  if ! managed_runner_image_handoff_from_kind_registry "${runner_image}"; then
    return 0
  fi
  if ! managed_runner_image_handoff_is_digest_ref "${runner_image}"; then
    echo "${log_prefix} local kind registry runner image must be a digest ref before workload start: ${runner_image}" >&2
    return 1
  fi

  registry_name="$(scenario_kind_registry_name)"
  registry_container_port="${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-5000}"
  managed_runner_image_handoff_source_kind_bootstrap "${root_dir}" "${log_prefix}" || return 1
  if ! kind_configure_registry_no_proxy_for_containerd "${node_name}" "${registry_name}" "${registry_container_port}"; then
    echo "${log_prefix} failed to reconcile kind control-plane containerd NO_PROXY for ${registry_name}:${registry_container_port}" >&2
    return 1
  fi

  echo "${log_prefix} preflighting kind containerd pull for managed runner image ${runner_image}" >&2
  if ! pull_output="$(docker exec "${node_name}" crictl pull "${runner_image}" 2>&1)"; then
    echo "${log_prefix} failed to pull managed runner image from local kind registry inside ${node_name}: ${runner_image}" >&2
    printf '%s\n' "${pull_output}" >&2
    echo "${log_prefix} check kind-registry connectivity and containerd NO_PROXY for ${registry_name}:${registry_container_port}." >&2
    return 1
  fi
}
