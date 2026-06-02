#!/usr/bin/env bash
set -euo pipefail

llmup_image_lock_die() {
  local message="$1"
  if declare -F die >/dev/null 2>&1; then
    die "${message}"
  fi
  printf 'ERROR: %s\n' "${message}" >&2
  exit 1
}

llmup_image_lock_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

llmup_image_lock_parse_key_values() {
  local lock_path="$1"
  local raw_line=""
  local line=""
  local key=""
  local value=""
  local line_number=0
  local seen_version=0
  local seen_source_image=0
  local seen_release_url=0
  local seen_commit_sha=0

  [[ -f "${lock_path}" ]] || llmup_image_lock_die "missing llmup image lock at ${lock_path}"

  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    line_number=$((line_number + 1))
    raw_line="${raw_line%$'\r'}"
    line="$(llmup_image_lock_trim "${raw_line}")"

    if [[ -z "${line}" || "${line}" == \#* ]]; then
      continue
    fi
    if [[ "${line}" != *"="* ]]; then
      llmup_image_lock_die "invalid llmup image lock line ${line_number}: expected key=value"
    fi

    key="$(llmup_image_lock_trim "${line%%=*}")"
    value="$(llmup_image_lock_trim "${line#*=}")"
    case "${key}" in
      llmup_version)
        [[ "${seen_version}" == "0" ]] || llmup_image_lock_die "duplicate llmup image lock entry: llmup_version"
        seen_version=1
        LLMUP_IMAGE_LOCK_VERSION="${value}"
        ;;
      llmup_source_image)
        [[ "${seen_source_image}" == "0" ]] || llmup_image_lock_die "duplicate llmup image lock entry: llmup_source_image"
        seen_source_image=1
        LLMUP_IMAGE_LOCK_SOURCE_IMAGE="${value}"
        ;;
      llmup_release_url)
        [[ "${seen_release_url}" == "0" ]] || llmup_image_lock_die "duplicate llmup image lock entry: llmup_release_url"
        seen_release_url=1
        LLMUP_IMAGE_LOCK_RELEASE_URL="${value}"
        ;;
      llmup_commit_sha)
        [[ "${seen_commit_sha}" == "0" ]] || llmup_image_lock_die "duplicate llmup image lock entry: llmup_commit_sha"
        seen_commit_sha=1
        LLMUP_IMAGE_LOCK_COMMIT_SHA="${value}"
        ;;
      *)
        llmup_image_lock_die "unknown llmup image lock key on line ${line_number}: ${key}"
        ;;
    esac
  done < "${lock_path}"

  [[ -n "${LLMUP_IMAGE_LOCK_VERSION:-}" ]] || llmup_image_lock_die "llmup image lock must include llmup_version"
  [[ -n "${LLMUP_IMAGE_LOCK_SOURCE_IMAGE:-}" ]] || llmup_image_lock_die "llmup image lock must include llmup_source_image"
  [[ -n "${LLMUP_IMAGE_LOCK_RELEASE_URL:-}" ]] || llmup_image_lock_die "llmup image lock must include llmup_release_url"
  [[ -n "${LLMUP_IMAGE_LOCK_COMMIT_SHA:-}" ]] || llmup_image_lock_die "llmup image lock must include llmup_commit_sha"
}

llmup_image_lock_validate_source_image() {
  local subject="$1"
  local version="$2"
  local source_image="$3"
  local ref_without_digest=""
  local last_component=""
  local tag=""

  [[ -n "${version}" ]] || llmup_image_lock_die "LLMUP_VERSION must not be empty"
  [[ -n "${source_image}" ]] || llmup_image_lock_die "${subject} must include an image ref"

  if [[ ! "${source_image}" =~ @sha256:[a-fA-F0-9]{64}$ ]]; then
    llmup_image_lock_die "${subject} must include a sha256 digest"
  fi

  LLMUP_SOURCE_IMAGE_DIGEST="${BASH_REMATCH[0]#@}"
  LLMUP_SOURCE_IMAGE_DIGEST="${LLMUP_SOURCE_IMAGE_DIGEST,,}"
  ref_without_digest="${source_image%@sha256:*}"
  last_component="${ref_without_digest##*/}"

  if [[ "${last_component}" != *":"* ]]; then
    llmup_image_lock_die "${subject} must include an image tag matching LLMUP_VERSION"
  fi

  tag="${last_component##*:}"
  [[ -n "${tag}" ]] || llmup_image_lock_die "${subject} must not use an empty image tag"
  if [[ "${tag,,}" == "latest" ]]; then
    llmup_image_lock_die "${subject} must not use latest tag"
  fi
  if [[ "${tag}" != "${version}" ]]; then
    llmup_image_lock_die "${subject} tag must match LLMUP_VERSION"
  fi
}

resolve_llmup_image_lock() {
  local lock_path="$1"
  local resolved_version=""
  local resolved_source_image=""

  LLMUP_IMAGE_LOCK_VERSION=""
  LLMUP_IMAGE_LOCK_SOURCE_IMAGE=""
  LLMUP_IMAGE_LOCK_RELEASE_URL=""
  LLMUP_IMAGE_LOCK_COMMIT_SHA=""
  llmup_image_lock_parse_key_values "${lock_path}"

  resolved_version="${LLMUP_VERSION:-${LLMUP_IMAGE_LOCK_VERSION}}"
  resolved_source_image="${LLMUP_SOURCE_IMAGE:-${LLMUP_IMAGE_LOCK_SOURCE_IMAGE}}"

  llmup_image_lock_validate_source_image "LLMUP_SOURCE_IMAGE" "${resolved_version}" "${resolved_source_image}"

  LLMUP_VERSION="${resolved_version}"
  LLMUP_SOURCE_IMAGE="${resolved_source_image}"
  LLMUP_RELEASE_URL="${LLMUP_IMAGE_LOCK_RELEASE_URL}"
  LLMUP_COMMIT_SHA="${LLMUP_IMAGE_LOCK_COMMIT_SHA}"
  export LLMUP_VERSION LLMUP_SOURCE_IMAGE LLMUP_RELEASE_URL LLMUP_COMMIT_SHA
}
