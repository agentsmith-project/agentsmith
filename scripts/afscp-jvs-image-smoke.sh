#!/usr/bin/env bash
set -euo pipefail

AFSCP_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.6@sha256:9ddeb916ed77f5a4ecd751b59488a017564c27392c62ed97f69c1dbec1e497f1}}"
EXPECTED_JVS_SHA256="${EXPECTED_JVS_SHA256:-fa4ada8e3353f85679d13870ea53307caafbd8217b04ba576b185105d9178cef}"
EXPECTED_JVS_SOURCE_REF="${EXPECTED_JVS_SOURCE_REF:-jvs@v0.4.10:6a0f7628764ce2430b2b754a7375ca67f637ad08}"

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

container_id="$(docker create --network none --entrypoint /usr/local/bin/jvs "${AFSCP_IMAGE}" afscp --help)"
docker cp "${container_id}:/usr/local/bin/jvs" "${tmp_dir}/jvs" >/dev/null

actual_sha="$(sha256sum "${tmp_dir}/jvs" | awk '{print $1}')"
if [[ "${actual_sha}" != "${EXPECTED_JVS_SHA256}" ]]; then
  err "embedded /usr/local/bin/jvs SHA-256 mismatch: expected ${EXPECTED_JVS_SHA256}, got ${actual_sha}"
  exit 1
fi

info "passed: /usr/local/bin/jvs afscp --help works and SHA-256 matches ${actual_sha}"
info "scope: focused pinned-image smoke only; not full AFSCP runtime readiness"
