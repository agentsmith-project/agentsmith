#!/usr/bin/env bash
set -euo pipefail

AFSCP_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.24@sha256:927b42659daf67312a7512c58294a824c625b4485d5bf7e24d6eb6eaecae2c1a}}"
EXPECTED_JVS_SHA256="${EXPECTED_JVS_SHA256:-fa4ada8e3353f85679d13870ea53307caafbd8217b04ba576b185105d9178cef}"
EXPECTED_JVS_SOURCE_REF="${EXPECTED_JVS_SOURCE_REF:-jvs@v0.4.10:6a0f762bc436f0d3dc7c7c1d60847992c3a82718}"
AFSCP_JUICEFS_OUTPUT_PATH="${AFSCP_JUICEFS_OUTPUT_PATH:-}"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agentsmith-afscp-jvs-image-smoke.XXXXXX")"
container_id=""

cleanup() {
  if [[ -n "${container_id}" ]]; then
    docker rm -f "${container_id}" >/dev/null 2>&1 || true
  fi
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

err() {
  printf '[afscp-jvs-image-smoke] ERROR: %s\n' "$*" >&2
}

info() {
  printf '[afscp-jvs-image-smoke] %s\n' "$*"
}

if ! command -v docker >/dev/null 2>&1; then
  err "docker is required"
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  err "sha256sum is required"
  exit 1
fi

info "checking pinned AFSCP image: ${AFSCP_IMAGE}"
info "expected embedded JVS source: ${EXPECTED_JVS_SOURCE_REF}"

if ! docker image inspect "${AFSCP_IMAGE}" >/dev/null 2>&1; then
  docker pull "${AFSCP_IMAGE}" >/dev/null
fi

docker run --rm --network=none --entrypoint /usr/local/bin/jvs "${AFSCP_IMAGE}" afscp --help > "${tmp_dir}/jvs-afscp-help.txt"
docker run --rm --network=none --entrypoint /usr/local/bin/juicefs "${AFSCP_IMAGE}" version > "${tmp_dir}/juicefs-version.txt"
docker run --rm --network=none --entrypoint /usr/local/bin/juicefs "${AFSCP_IMAGE}" clone --help > "${tmp_dir}/juicefs-clone-help.txt"

if ! grep -q '^juicefs version ' "${tmp_dir}/juicefs-version.txt"; then
  err "embedded /usr/local/bin/juicefs did not report a version"
  exit 1
fi
if ! grep -q 'juicefs clone' "${tmp_dir}/juicefs-clone-help.txt"; then
  err "embedded /usr/local/bin/juicefs does not expose clone"
  exit 1
fi

container_id="$(docker create --network none --entrypoint /usr/local/bin/jvs "${AFSCP_IMAGE}" afscp --help)"
docker cp "${container_id}:/usr/local/bin/jvs" "${tmp_dir}/jvs" >/dev/null
if [[ -n "${AFSCP_JUICEFS_OUTPUT_PATH}" ]]; then
  juicefs_output_dir="$(dirname "${AFSCP_JUICEFS_OUTPUT_PATH}")"
  juicefs_lib_output_dir="${juicefs_output_dir}/juicefs-lib"
  mkdir -p "${juicefs_output_dir}"
  rm -f "${AFSCP_JUICEFS_OUTPUT_PATH}"
  rm -rf "${juicefs_lib_output_dir}"
  docker cp "${container_id}:/usr/local/bin/juicefs" "${AFSCP_JUICEFS_OUTPUT_PATH}" >/dev/null
  docker cp "${container_id}:/usr/local/juicefs-lib" "${juicefs_lib_output_dir}" >/dev/null
  chmod 0755 "${AFSCP_JUICEFS_OUTPUT_PATH}"
  LD_LIBRARY_PATH="${juicefs_lib_output_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}" \
    "${AFSCP_JUICEFS_OUTPUT_PATH}" version > "${tmp_dir}/juicefs-export-version.txt"
  if ! grep -q '^juicefs version ' "${tmp_dir}/juicefs-export-version.txt"; then
    err "exported /usr/local/bin/juicefs did not report a version"
    exit 1
  fi
fi

actual_sha="$(sha256sum "${tmp_dir}/jvs" | awk '{print $1}')"
if [[ "${actual_sha}" != "${EXPECTED_JVS_SHA256}" ]]; then
  err "embedded /usr/local/bin/jvs SHA-256 mismatch: expected ${EXPECTED_JVS_SHA256}, got ${actual_sha}"
  exit 1
fi

info "passed: /usr/local/bin/jvs afscp --help works and SHA-256 matches ${actual_sha}"
info "passed: /usr/local/bin/juicefs version and clone --help work"
if [[ -n "${AFSCP_JUICEFS_OUTPUT_PATH}" ]]; then
  info "prepared: ${AFSCP_JUICEFS_OUTPUT_PATH}"
fi
info "scope: focused pinned-image smoke only; not full AFSCP runtime readiness"
