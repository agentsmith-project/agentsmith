ASBCP_CANONICAL_SOURCE_REPOSITORY="${ASBCP_CANONICAL_SOURCE_REPOSITORY:-ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane}"
ASBCP_LOCAL_KIND_MIRROR_REPOSITORY="${ASBCP_LOCAL_KIND_MIRROR_REPOSITORY:-kind-registry:5000/mbos/agentsmith-sandbox-control-plane}"

asbcp_image_error() {
  local message="$1"
  if declare -F internal_err >/dev/null 2>&1; then
    internal_err "${message}"
    return 0
  fi
  printf '%s %s\n' "${ASBCP_IMAGE_ERROR_PREFIX:-[asbcp-image]}" "${message}" >&2
}

asbcp_image_lock_value() {
  local lock_path="$1"
  local key="$2"
  awk -F= -v key="${key}" '$1 == key { print substr($0, length($1) + 2) }' "${lock_path}" | tail -n1
}

asbcp_image_ref_repo() {
  local image="$1"
  local without_digest last_path
  without_digest="${image%%@sha256:*}"
  last_path="${without_digest##*/}"
  if [[ "${last_path}" == *:* ]]; then
    printf '%s\n' "${without_digest%:*}"
    return 0
  fi
  printf '%s\n' "${without_digest}"
}

asbcp_image_ref_tag() {
  local image="$1"
  local without_digest last_path
  without_digest="${image%%@sha256:*}"
  last_path="${without_digest##*/}"
  if [[ "${last_path}" == *:* ]]; then
    printf '%s\n' "${last_path##*:}"
  fi
}

asbcp_image_ref_digest() {
  local image="$1"
  local digest
  if [[ "${image}" != *@sha256:* ]]; then
    return 0
  fi
  digest="${image##*@}"
  printf '%s\n' "${digest}" | tr 'A-F' 'a-f'
}

asbcp_image_validate_pinned_digest() {
  local image="$1"
  local label="$2"
  local digest_hex repeated
  if [[ ! "${image}" =~ @sha256:[a-fA-F0-9]{64}$ ]]; then
    asbcp_image_error "${label} must be pinned by digest: ${image}"
    return 1
  fi
  digest_hex="$(asbcp_image_ref_digest "${image}")"
  digest_hex="${digest_hex#sha256:}"
  repeated="${digest_hex//${digest_hex:0:1}/}"
  if [[ -z "${repeated}" ]]; then
    asbcp_image_error "${label} uses a placeholder digest and is not pullable: ${image}"
    return 1
  fi
}

asbcp_image_validate_repo_tail() {
  local image="$1"
  local repo repo_name
  repo="$(asbcp_image_ref_repo "${image}")"
  repo_name="${repo##*/}"
  if [[ "${repo_name}" != "agentsmith-sandbox-control-plane" ]]; then
    asbcp_image_error "ASBCP_IMAGE must use canonical agentsmith-sandbox-control-plane repository: ${image}"
    return 1
  fi
}

asbcp_image_validate_lock_image() {
  local image="$1"
  local lock_path="$2"
  local repo tag version
  asbcp_image_validate_pinned_digest "${image}" "ASBCP image lock asbcp_source_image" || return 1
  asbcp_image_validate_repo_tail "${image}" || return 1
  repo="$(asbcp_image_ref_repo "${image}")"
  if [[ "${repo}" != "${ASBCP_CANONICAL_SOURCE_REPOSITORY}" ]]; then
    asbcp_image_error "ASBCP image lock asbcp_source_image must use canonical GHCR repo ${ASBCP_CANONICAL_SOURCE_REPOSITORY}: ${image}"
    return 1
  fi
  tag="$(asbcp_image_ref_tag "${image}")"
  if [[ -z "${tag}" ]]; then
    asbcp_image_error "ASBCP image lock asbcp_source_image must include the ASBCP release tag: ${image}"
    return 1
  fi
  version="$(asbcp_image_lock_value "${lock_path}" "asbcp_version")"
  if [[ -n "${version}" && "${tag}" != "${version}" ]]; then
    asbcp_image_error "ASBCP image lock asbcp_source_image tag must match asbcp_version: ${image}"
    return 1
  fi
}

asbcp_image_validate_override_image() {
  local image="$1"
  local lock_image="${2:-}"
  local repo tag digest lock_tag lock_digest
  asbcp_image_validate_pinned_digest "${image}" "ASBCP_IMAGE" || return 1
  asbcp_image_validate_repo_tail "${image}" || return 1
  repo="$(asbcp_image_ref_repo "${image}")"
  if [[ "${repo}" != "${ASBCP_CANONICAL_SOURCE_REPOSITORY}" && "${repo}" != "${ASBCP_LOCAL_KIND_MIRROR_REPOSITORY}" ]]; then
    asbcp_image_error "ASBCP_IMAGE must use canonical ASBCP image repository (${ASBCP_CANONICAL_SOURCE_REPOSITORY} or ${ASBCP_LOCAL_KIND_MIRROR_REPOSITORY}): ${image}"
    return 1
  fi
  if [[ -z "${lock_image}" ]]; then
    return 0
  fi

  digest="$(asbcp_image_ref_digest "${image}")"
  lock_digest="$(asbcp_image_ref_digest "${lock_image}")"
  if [[ "${digest}" != "${lock_digest}" ]]; then
    asbcp_image_error "ASBCP_IMAGE digest must match asbcp-image.lock: ${image}"
    return 1
  fi

  tag="$(asbcp_image_ref_tag "${image}")"
  lock_tag="$(asbcp_image_ref_tag "${lock_image}")"
  if [[ "${repo}" == "${ASBCP_CANONICAL_SOURCE_REPOSITORY}" && "${tag}" != "${lock_tag}" ]]; then
    asbcp_image_error "ASBCP_IMAGE tag must match asbcp-image.lock: ${image}"
    return 1
  fi
  if [[ "${repo}" == "${ASBCP_LOCAL_KIND_MIRROR_REPOSITORY}" && -n "${tag}" && "${tag}" != "${lock_tag}" ]]; then
    asbcp_image_error "ASBCP_IMAGE tag must match asbcp-image.lock: ${image}"
    return 1
  fi
}

asbcp_resolve_locked_image() {
  local override_image="${1:-}"
  local lock_path="${2:-}"
  local lock_image=""

  if [[ -n "${lock_path}" && -r "${lock_path}" ]]; then
    lock_image="$(asbcp_image_lock_value "${lock_path}" "asbcp_source_image")"
    if [[ -z "${lock_image}" ]]; then
      asbcp_image_error "ASBCP image lock must include asbcp_source_image: ${lock_path}"
      return 1
    fi
    asbcp_image_validate_lock_image "${lock_image}" "${lock_path}" || return 1
  fi

  if [[ -n "${override_image}" ]]; then
    asbcp_image_validate_override_image "${override_image}" "${lock_image}" || return 1
    printf '%s\n' "${override_image}"
    return 0
  fi

  if [[ -n "${lock_image}" ]]; then
    printf '%s\n' "${lock_image}"
    return 0
  fi

  asbcp_image_error "missing ASBCP_IMAGE and image lock: ${lock_path}"
  return 1
}
