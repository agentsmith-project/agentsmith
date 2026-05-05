#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"

RUNNER_KIND="${1:-}"
BASE_IMAGE="${2:-}"
IMAGE_TAG="${3:-}"
SOURCE_ROOT="${4:-${ROOT_DIR}}"

if [[ -z "${RUNNER_KIND}" || -z "${BASE_IMAGE}" || -z "${IMAGE_TAG}" ]]; then
  echo "usage: scripts/build-runner-image.sh <agent-task> <base-image> <image-tag> [source-root]" >&2
  exit 1
fi

DOCKER_BUILD_PROXY_VALUE="${RUNNER_IMAGE_DOCKER_BUILD_PROXY:-${DOCKER_BUILD_PROXY:-${HTTP_PROXY:-}}}"
BUILD_BASE="${RUNNER_IMAGE_BUILD_BASE:-1}"
REBUILD_IMAGE="${RUNNER_IMAGE_REBUILD:-1}"

build_runner_image "${RUNNER_KIND}" "${BASE_IMAGE}" "${IMAGE_TAG}" "${DOCKER_BUILD_PROXY_VALUE}" "${BUILD_BASE}" "${REBUILD_IMAGE}" "${SOURCE_ROOT}"
