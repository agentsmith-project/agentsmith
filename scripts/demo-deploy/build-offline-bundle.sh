#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
source "${ROOT_DIR}/scripts/lib/ensure-juicefs-vendor.sh"
source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"
source "${ROOT_DIR}/scripts/lib/image-archive-manifest.sh"
source "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
source "${ROOT_DIR}/scripts/lib/llmup-image-lock.sh"
RELEASE_STORY_SOURCE_SET_NAME="$(release_story_verify_source_set_name)"
RELEASE_STORY_SOURCE_SET_HELPER="$(release_story_verify_source_set_helper_path)"
OUT_DIR="${OUT_DIR:-${HOME}/agentsmith/deploy/uploads}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
BUNDLE_DIR="${OUT_DIR}/agentsmith-${RELEASE_ID}"
IMAGES_DIR="${BUNDLE_DIR}/images"
TOOLS_DIR="${BUNDLE_DIR}/tools"
BUNDLE_PLATFORM="${BUNDLE_PLATFORM:-linux/amd64}"
LLMUP_IMAGE_LOCK="${LLMUP_IMAGE_LOCK:-${ROOT_DIR}/infra/deploy/shared/llmup-image.lock}"
BUNDLED_IMAGE_ARCHIVES_INCLUDED=1
if [[ "${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-0}" == "1" ]]; then
  BUNDLED_IMAGE_ARCHIVES_INCLUDED=0
fi

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }; }
require_cmd docker
require_cmd tar
require_cmd sha256sum
require_cmd python3
require_cmd kind
require_cmd kubectl
require_cmd juicefs
require_cmd mc

if [[ "${SKIP_BUNDLE_INPUTS_CHECK:-0}" != "1" ]]; then
  (cd "${ROOT_DIR}" && npm run test:demo-bundle:inputs)
  (cd "${ROOT_DIR}" && npm run test:demo-rendered-env)
  (cd "${ROOT_DIR}" && npm run test:client-public-runtime)
fi

if [[ "${RUN_RELEASE_PRECHECK:-0}" == "1" && "${SKIP_RELEASE_PRECHECK:-0}" != "1" ]]; then
  (cd "${ROOT_DIR}" && npm run test:release:precheck)
fi

docker_bridge_gateway() {
  docker network inspect bridge -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
    | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
}

DOCKER_PROXY_HOST="${DOCKER_BUILD_PROXY_HOST:-$(docker_bridge_gateway)}"

normalize_build_proxy() {
  local proxy_value="$1"
  if [[ -z "${proxy_value}" ]]; then
    return 0
  fi
  python3 - <<'PY' "${proxy_value}" "${DOCKER_PROXY_HOST}"
from urllib.parse import urlparse, urlunparse
import sys

proxy = sys.argv[1]
gateway = sys.argv[2] or "172.17.0.1"
parsed = urlparse(proxy)
host = parsed.hostname or ""
if host in {"0.0.0.0", "127.0.0.1", "localhost"}:
    netloc = gateway
    if parsed.port:
        netloc = f"{gateway}:{parsed.port}"
    if parsed.username:
        credentials = parsed.username
        if parsed.password:
            credentials += f":{parsed.password}"
        netloc = f"{credentials}@{netloc}"
    parsed = parsed._replace(netloc=netloc)
print(urlunparse(parsed))
PY
}

hash_files() {
  sha256sum "$@" | sha256sum | cut -c1-16
}

BUILD_ARGS=()
for proxy_key in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
  if [[ -n "${!proxy_key:-}" ]]; then
    proxy_value="${!proxy_key}"
    if [[ "${proxy_key}" != "NO_PROXY" && "${proxy_key}" != "no_proxy" ]]; then
      proxy_value="$(normalize_build_proxy "${proxy_value}")"
    fi
    BUILD_ARGS+=(--build-arg "${proxy_key}=${proxy_value}")
  fi
done

mkdir -p "${OUT_DIR}"
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}" "${TOOLS_DIR}"
if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  mkdir -p "${IMAGES_DIR}"
fi

APP_BASE_HASH="$(hash_files \
  "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/packages/adapters-cf/package.json" \
  "${ROOT_DIR}/packages/adapters-private/package.json" \
  "${ROOT_DIR}/packages/notebook-codex-runner/package.json" \
  "${ROOT_DIR}/packages/api-entry-cf/package.json" \
  "${ROOT_DIR}/packages/api-entry-node/package.json" \
  "${ROOT_DIR}/packages/application/package.json" \
  "${ROOT_DIR}/packages/contracts/package.json" \
  "${ROOT_DIR}/packages/domain/package.json" \
  "${ROOT_DIR}/packages/ports/package.json")"
RUNNER_BASE_HASH="$(hash_files \
  "${ROOT_DIR}/infra/runner/Dockerfile.notebook-codex-runner-base" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/packages/agent-runner/package.json" \
  "${ROOT_DIR}/packages/notebook-codex-runner/package.json")"
CHAT_RUNNER_BASE_HASH="$(hash_files \
  "${ROOT_DIR}/infra/runner/Dockerfile.chat-llm-runner-base" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/packages/agent-runner/package.json" \
  "${ROOT_DIR}/packages/chat-llm-runner/package.json")"
VERIFY_RUNNER_BASE_HASH="$(hash_files \
  "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/packages/adapters-cf/package.json" \
  "${ROOT_DIR}/packages/adapters-private/package.json" \
  "${ROOT_DIR}/packages/notebook-codex-runner/package.json" \
  "${ROOT_DIR}/packages/api-entry-cf/package.json" \
  "${ROOT_DIR}/packages/api-entry-node/package.json" \
  "${ROOT_DIR}/packages/application/package.json" \
  "${ROOT_DIR}/packages/contracts/package.json" \
  "${ROOT_DIR}/packages/domain/package.json" \
  "${ROOT_DIR}/packages/ports/package.json")"

APP_BASE_IMAGE="${APP_BASE_IMAGE:-agentsmith-app-base:${APP_BASE_HASH}}"
RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE:-agentsmith-notebook-codex-runner-base:${RUNNER_BASE_HASH}}"
CHAT_RUNNER_BASE_IMAGE="${CHAT_RUNNER_BASE_IMAGE:-agentsmith-chat-llm-runner-base:${CHAT_RUNNER_BASE_HASH}}"
VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE:-agentsmith-verify-runner-base:${VERIFY_RUNNER_BASE_HASH}}"
APP_IMAGE="${APP_IMAGE:-agentsmith-app:${RELEASE_ID}}"
RUNNER_IMAGE="${RUNNER_IMAGE:-agentsmith-notebook-codex-runner:${RELEASE_ID}}"
CHAT_RUNNER_IMAGE="${CHAT_RUNNER_IMAGE:-agentsmith-chat-llm-runner:${RELEASE_ID}}"
VERIFY_RUNNER_IMAGE="${VERIFY_RUNNER_IMAGE:-agentsmith-verify-runner:${RELEASE_ID}}"
SANDBOX_MANAGER_IMAGE="${SANDBOX_MANAGER_IMAGE:-sandbox-manager:${RELEASE_ID}}"
resolve_llmup_image_lock "${LLMUP_IMAGE_LOCK}"
UNIVERSAL_PROXY_IMAGE="${UNIVERSAL_PROXY_IMAGE:-llm-universal-proxy:${LLMUP_VERSION}}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"
JUICEFS_VERSION="${JUICEFS_VERSION:-1.3.0}"
JUICEFS_DOWNLOAD_BASE_URL="${JUICEFS_DOWNLOAD_BASE_URL:-https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}}"

cleanup_local_juicefs_vendor=0
if [[ ! -d "${ROOT_DIR}/infra/vendor/juicefs" ]]; then
  cleanup_local_juicefs_vendor=1
fi
cleanup_generated_vendor() {
  if [[ "${cleanup_local_juicefs_vendor}" == "1" ]]; then
    rm -rf "${ROOT_DIR}/infra/vendor/juicefs"
  fi
}
trap cleanup_generated_vendor EXIT
ensure_juicefs_vendor_dir "${ROOT_DIR}" "${JUICEFS_VERSION}" "${JUICEFS_DOWNLOAD_BASE_URL}"

echo "[bundle] building app base image ${APP_BASE_IMAGE}"
docker_build_local "${BUILD_ARGS[@]}" -t "${APP_BASE_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" "${ROOT_DIR}"

echo "[bundle] building app image ${APP_IMAGE}"
docker_build_local "${BUILD_ARGS[@]}" --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" -t "${APP_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-app" "${ROOT_DIR}"

echo "[bundle] building external runner base image ${RUNNER_BASE_IMAGE}"
RUNNER_IMAGE_DOCKER_BUILD_PROXY="${DOCKER_BUILD_PROXY:-${HTTP_PROXY:-}}"
export RUNNER_IMAGE_DOCKER_BUILD_PROXY
build_runner_image notebook "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${RUNNER_IMAGE_DOCKER_BUILD_PROXY}" "1" "1" "${ROOT_DIR}"

echo "[bundle] building chat runner base image ${CHAT_RUNNER_BASE_IMAGE}"
build_runner_image chat "${CHAT_RUNNER_BASE_IMAGE}" "${CHAT_RUNNER_IMAGE}" "${RUNNER_IMAGE_DOCKER_BUILD_PROXY}" "1" "1" "${ROOT_DIR}"

echo "[bundle] building verify runner base image ${VERIFY_RUNNER_BASE_IMAGE}"
docker_build_local "${BUILD_ARGS[@]}" -t "${VERIFY_RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" "${ROOT_DIR}"

echo "[bundle] building verify runner image ${VERIFY_RUNNER_IMAGE}"
docker_build_local "${BUILD_ARGS[@]}" --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${ROOT_DIR}"

echo "[bundle] building sandbox manager image ${SANDBOX_MANAGER_IMAGE}"
docker_build_local "${BUILD_ARGS[@]}" -t "${SANDBOX_MANAGER_IMAGE}" -f "${SANDBOX_ROOT}/manager-service/Dockerfile" "${SANDBOX_ROOT}/manager-service"

echo "[bundle] pulling universal proxy source image ${LLMUP_SOURCE_IMAGE}"
docker pull --platform "${BUNDLE_PLATFORM}" "${LLMUP_SOURCE_IMAGE}"
docker tag "${LLMUP_SOURCE_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"

DEPENDENCY_IMAGES=(
  "pgvector/pgvector:pg16"
  "mongo:7"
  "redis:7-alpine"
  "minio/minio:latest"
  "minio/mc:latest"
  "quay.io/keycloak/keycloak:26.0"
  "registry:2"
  "kindest/node:v1.32.2"
  "juicedata/juicefs-csi-driver:${JUICEFS_CSI_VERSION}"
  "juicedata/csi-dashboard:${JUICEFS_CSI_VERSION}"
  "juicedata/mount:ce-v1.3.1"
  "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
  "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
  "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
  "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"
)

for image in "${DEPENDENCY_IMAGES[@]}"; do
  echo "[bundle] pulling ${image}"
  docker pull --platform "${BUNDLE_PLATFORM}" "${image}"
done

BUILT_IMAGES=(
  "${APP_BASE_IMAGE}"
  "${APP_IMAGE}"
  "${RUNNER_BASE_IMAGE}"
  "${RUNNER_IMAGE}"
  "${CHAT_RUNNER_BASE_IMAGE}"
  "${CHAT_RUNNER_IMAGE}"
  "${VERIFY_RUNNER_BASE_IMAGE}"
  "${VERIFY_RUNNER_IMAGE}"
  "${SANDBOX_MANAGER_IMAGE}"
  "${UNIVERSAL_PROXY_IMAGE}"
)

ALL_IMAGES=(
  "${BUILT_IMAGES[@]}"
  "${DEPENDENCY_IMAGES[@]}"
)

if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  for image in "${ALL_IMAGES[@]}"; do
    file_name="$(printf '%s' "${image}" | tr '/:@' '---').tar"
    echo "[bundle] saving ${image}"
    if printf '%s\n' "${DEPENDENCY_IMAGES[@]}" | grep -Fxq "${image}"; then
      save_image_archive_with_cache \
        "${image}" \
        "${IMAGES_DIR}/${file_name}" \
        "${OUT_DIR}" \
        "${BUNDLE_DIR}" \
        "platform" \
        "${BUNDLE_PLATFORM}"
    else
      save_image_archive_with_cache \
        "${image}" \
        "${IMAGES_DIR}/${file_name}" \
        "${OUT_DIR}" \
        "${BUNDLE_DIR}" \
        "default" \
        "${BUNDLE_PLATFORM}"
    fi
  done
else
  echo "[bundle] skipped bundled image archive generation for ${BUNDLE_DIR}"
fi

mkdir -p "${BUNDLE_DIR}/compose" "${BUNDLE_DIR}/env" "${BUNDLE_DIR}/kind" "${BUNDLE_DIR}/scripts" "${BUNDLE_DIR}/postgres-init" "${BUNDLE_DIR}/minio" "${BUNDLE_DIR}/keycloak" "${BUNDLE_DIR}/k8s" "${BUNDLE_DIR}/e2e" "${BUNDLE_DIR}/infra/runtime"
mkdir -p "${BUNDLE_DIR}/universal-proxy"

copy_bundle_file() {
  local source_file="$1"
  local target_file="$2"
  rm -rf "${target_file}"
  mkdir -p "$(dirname "${target_file}")"
  cp "${source_file}" "${target_file}"
}

cp "${ROOT_DIR}/infra/deploy/demo/docker-compose.yml" "${BUNDLE_DIR}/compose/docker-compose.yml"
cp "${ROOT_DIR}/infra/deploy/demo/deployment.manifest.json" "${BUNDLE_DIR}/deployment.manifest.json"
cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${BUNDLE_DIR}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/demo/kind/config.yaml" "${BUNDLE_DIR}/kind/config.yaml"
cp "${ROOT_DIR}/infra/deploy/shared/universal-proxy/config.yaml" "${BUNDLE_DIR}/universal-proxy/config.yaml"
cp "${ROOT_DIR}/scripts/check-preset-external-file-library.sh" "${BUNDLE_DIR}/scripts/check-preset-external-file-library.sh"
cp "${ROOT_DIR}/scripts/file-library-real-smoke.sh" "${BUNDLE_DIR}/scripts/file-library-real-smoke.sh"
cp "${ROOT_DIR}/scripts/notebook-agent-refresh-token.js" "${BUNDLE_DIR}/scripts/notebook-agent-refresh-token.js"
cp "${ROOT_DIR}/infra/deploy/demo/k8s/juicefs-csi.yaml" "${BUNDLE_DIR}/k8s/juicefs-csi.yaml"
cp "${ROOT_DIR}/infra/integration/postgres-init/001-create-databases.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/packages/adapters-private/sql/projects.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/infra/integration/minio/init-minio.sh" "${BUNDLE_DIR}/minio/"
cp "${ROOT_DIR}/infra/integration/keycloak/realm-mbos-dev.json" "${BUNDLE_DIR}/keycloak/"
cp "${ROOT_DIR}/scripts/demo-deploy/"*.sh "${BUNDLE_DIR}/scripts/"
mkdir -p "${BUNDLE_DIR}/scripts/lib"
cp "${ROOT_DIR}/scripts/lib/common.sh" "${BUNDLE_DIR}/scripts/lib/common.sh"
cp "${ROOT_DIR}/scripts/lib/deploy-common.sh" "${BUNDLE_DIR}/scripts/lib/deploy-common.sh"
cp "${ROOT_DIR}/scripts/lib/release-stage-common.sh" "${BUNDLE_DIR}/scripts/lib/release-stage-common.sh"
cp "${ROOT_DIR}/scripts/lib/bootstrap-common.sh" "${BUNDLE_DIR}/scripts/lib/bootstrap-common.sh"
cp "${ROOT_DIR}/scripts/lib/k8s-external-services.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh"
cp "${ROOT_DIR}/scripts/lib/preset-common.sh" "${BUNDLE_DIR}/scripts/lib/preset-common.sh"
cp "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh" "${BUNDLE_DIR}/scripts/lib/release-story-verify-source-set.sh"
cp "${ROOT_DIR}/scripts/lib/runtime-verification.sh" "${BUNDLE_DIR}/scripts/lib/runtime-verification.sh"
cp "${ROOT_DIR}/scripts/lib/llmup-image-lock.sh" "${BUNDLE_DIR}/scripts/lib/llmup-image-lock.sh"
mkdir -p "${BUNDLE_DIR}/scripts/substrate"
cp "${ROOT_DIR}/scripts/substrate/deploy-common.sh" "${BUNDLE_DIR}/scripts/substrate/deploy-common.sh"
mkdir -p "${BUNDLE_DIR}/scripts/app"
cp "${ROOT_DIR}/scripts/app/deploy-common.sh" "${BUNDLE_DIR}/scripts/app/deploy-common.sh"
cp "${ROOT_DIR}/infra/runtime/presets.env" "${BUNDLE_DIR}/infra/runtime/presets.env"
chmod +x "${BUNDLE_DIR}"/scripts/*.sh "${BUNDLE_DIR}/scripts/lib/"*.sh
copy_bundle_file "${ROOT_DIR}/e2e/integration-real-helpers.ts" "${BUNDLE_DIR}/e2e/integration-real-helpers.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-files.spec.ts" "${BUNDLE_DIR}/e2e/integration-files.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/notebook-execution-outcome.ts" "${BUNDLE_DIR}/e2e/notebook-execution-outcome.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-access.ts" "${BUNDLE_DIR}/e2e/integration-workspace-access.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-entry.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-entry.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-publish-usable.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-publish-usable.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-preset-external-file-library.spec.ts" "${BUNDLE_DIR}/e2e/integration-preset-external-file-library.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-internal-chat-runner.spec.ts" "${BUNDLE_DIR}/e2e/integration-internal-chat-runner.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-chat-local-upstream.ts" "${BUNDLE_DIR}/e2e/integration-chat-local-upstream.ts"
copy_bundle_file "${ROOT_DIR}/e2e/internal-chat-isolation-probe.ts" "${BUNDLE_DIR}/e2e/internal-chat-isolation-probe.ts"
while IFS= read -r relative_path; do
  [[ -n "${relative_path}" ]] || continue
  copy_bundle_file "${ROOT_DIR}/${relative_path}" "${BUNDLE_DIR}/${relative_path}"
done < <(release_story_verify_source_set "${ROOT_DIR}")
mkdir -p "${BUNDLE_DIR}/docs/contracts"
cp "${ROOT_DIR}/docs/contracts/deployment-spec-v1.md" "${BUNDLE_DIR}/docs/contracts/deployment-spec-v1.md"
mkdir -p "${BUNDLE_DIR}/docs/user-guides"
cp "${ROOT_DIR}/docs/user-guides/demo-deploy-operations.md" "${BUNDLE_DIR}/docs/user-guides/demo-deploy-operations.md"
cp "${ROOT_DIR}/docs/user-guides/demo-deploy-simple-quickstart-zh.md" "${BUNDLE_DIR}/docs/user-guides/demo-deploy-simple-quickstart-zh.md"
cp "${ROOT_DIR}/scripts/demo-deploy-modes-gate.sh" "${BUNDLE_DIR}/scripts/demo-deploy-modes-gate.sh"
cp "${ROOT_DIR}/README-demo-deploy.md" "${BUNDLE_DIR}/README-demo-deploy.md"

cp "$(command -v kind)" "${TOOLS_DIR}/kind"
cp "$(command -v kubectl)" "${TOOLS_DIR}/kubectl"
cp "$(command -v juicefs)" "${TOOLS_DIR}/juicefs"
cp "$(command -v mc)" "${TOOLS_DIR}/mc"
chmod +x "${TOOLS_DIR}"/*

cat > "${BUNDLE_DIR}/VERSION" <<EOF
release_id=${RELEASE_ID}
agentsmith_app_base_image=${APP_BASE_IMAGE}
agentsmith_app_image=${APP_IMAGE}
agentsmith_runner_base_image=${RUNNER_BASE_IMAGE}
agentsmith_runner_image=${RUNNER_IMAGE}
agentsmith_chat_runner_base_image=${CHAT_RUNNER_BASE_IMAGE}
agentsmith_chat_runner_image=${CHAT_RUNNER_IMAGE}
agentsmith_verify_runner_base_image=${VERIFY_RUNNER_BASE_IMAGE}
agentsmith_verify_runner_image=${VERIFY_RUNNER_IMAGE}
sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}
llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}
llmup_version=${LLMUP_VERSION}
llmup_source_image=${LLMUP_SOURCE_IMAGE}
llmup_source_image_digest=${LLMUP_SOURCE_IMAGE_DIGEST}
bundled_image_archives_included=${BUNDLED_IMAGE_ARCHIVES_INCLUDED}
EOF

if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  write_image_archive_manifest "${BUNDLE_DIR}" "${RELEASE_ID}" "scripts/demo-deploy/build-offline-bundle.sh" "${BUNDLE_PLATFORM}"
fi

(cd "${BUNDLE_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > checksums.txt)

mapfile -t release_story_runtime_files < <(release_story_verify_source_set "${ROOT_DIR}")

python3 - <<'PY' "${BUNDLE_DIR}/deployment.manifest.json" "${BUNDLE_DIR}" "${RELEASE_STORY_SOURCE_SET_NAME}" "${RELEASE_STORY_SOURCE_SET_HELPER}" "${release_story_runtime_files[@]}"
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
bundle_root = pathlib.Path(sys.argv[2])
expected_source_set_name = sys.argv[3]
expected_source_set_helper = sys.argv[4]
required_source_files = sys.argv[5:]
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

for relative in manifest.get("bundle_files", []):
    path = bundle_root / relative
    if not path.exists():
        raise SystemExit(f"missing_bundle_file:{relative}")

bundle_source_sets = manifest.get("bundle_source_sets", [])
if not any(
    isinstance(entry, dict)
    and entry.get("name") == expected_source_set_name
    and entry.get("helper") == expected_source_set_helper
    for entry in bundle_source_sets
):
    raise SystemExit(f"missing_bundle_source_set:{expected_source_set_name}")

for relative in required_source_files:
    path = bundle_root / relative
    if not path.exists():
        raise SystemExit(f"missing_bundle_source_set_file:{relative}")

for tool_name in manifest.get("bundled_tools", []):
    path = bundle_root / "tools" / tool_name
    if not path.exists():
        raise SystemExit(f"missing_bundle_tool:{tool_name}")

env_keys = set()
for env_file in (bundle_root / "env").glob("*.example"):
    for raw_line in env_file.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        env_keys.add(line.split("=", 1)[0].strip())

for group in manifest.get("required_env", {}).values():
    for key in group:
        if key not in env_keys:
            raise SystemExit(f"missing_env_template_key:{key}")
PY

TMP_TAR_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz.tmp"
FINAL_TAR_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz"
if [[ "${SKIP_RELEASE_ARCHIVE:-0}" == "1" ]]; then
  echo "[bundle] skipped release archive packaging for ${BUNDLE_DIR}"
else
  rm -f "${TMP_TAR_PATH}" "${FINAL_TAR_PATH}"
  (cd "${OUT_DIR}" && tar -czf "${TMP_TAR_PATH##*/}" "agentsmith-${RELEASE_ID}")
  mv "${TMP_TAR_PATH}" "${FINAL_TAR_PATH}"
  echo "[bundle] wrote ${FINAL_TAR_PATH}"
fi
