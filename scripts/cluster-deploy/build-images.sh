#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"

ensure_operator_registry_env
load_registry_env

require_cmd docker

BASE_DEPENDENCY_IMAGE_LOCK="${BASE_DEPENDENCY_IMAGE_LOCK:-${ROOT_DIR}/infra/deploy/shared/build-base-images.lock}"
declare -A BASE_DEPENDENCY_IMAGE_LOCK_REFS=()

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

validate_image_ref_pinned_non_latest() {
  local subject="$1"
  local ref="$2"
  local ref_without_digest=""
  local last_component=""
  local tag=""

  if [[ -z "${ref}" ]]; then
    die "${subject} must include an image ref"
  fi
  if [[ ! "${ref}" =~ @sha256:[a-fA-F0-9]{64}$ ]]; then
    die "${subject} must include a sha256 digest"
  fi

  ref_without_digest="${ref%@sha256:*}"
  if [[ -z "${ref_without_digest}" ]]; then
    die "${subject} must include an image name"
  fi

  last_component="${ref_without_digest##*/}"
  if [[ "${last_component}" == *":"* ]]; then
    tag="${last_component##*:}"
    if [[ -z "${tag}" ]]; then
      die "${subject} must not use an empty image tag"
    fi
    if [[ "${tag,,}" == "latest" ]]; then
      die "${subject} must not use latest tag"
    fi
  fi
}

load_base_dependency_image_lock() {
  local lock_path="$1"
  local raw_line=""
  local line=""
  local id=""
  local ref=""
  local line_number=0

  [[ -f "${lock_path}" ]] || die "missing build base image lock at ${lock_path}"

  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    line_number=$((line_number + 1))
    raw_line="${raw_line%$'\r'}"
    line="$(trim_value "${raw_line}")"

    if [[ -z "${line}" || "${line}" == \#* ]]; then
      continue
    fi

    if [[ "${line}" == *"="* ]]; then
      id="$(trim_value "${line%%=*}")"
      ref="$(trim_value "${line#*=}")"
    else
      id="${line%%[[:space:]]*}"
      if [[ "${id}" == "${line}" ]]; then
        die "invalid build base image lock line ${line_number}: expected id=image@sha256:<digest> or id image@sha256:<digest>"
      fi
      ref="$(trim_value "${line#"${id}"}")"
      id="$(trim_value "${id}")"
    fi

    if [[ -z "${id}" || -z "${ref}" ]]; then
      die "invalid build base image lock line ${line_number}: expected id=image@sha256:<digest> or id image@sha256:<digest>"
    fi

    if [[ -n "${BASE_DEPENDENCY_IMAGE_LOCK_REFS[${id}]+x}" ]]; then
      die "duplicate build base image lock entry: ${id}"
    fi

    validate_image_ref_pinned_non_latest "build base image lock entry ${id}" "${ref}"
    BASE_DEPENDENCY_IMAGE_LOCK_REFS["${id}"]="${ref}"
  done < "${lock_path}"
}

locked_image_ref_or_die() {
  local id="$1"

  if [[ -z "${BASE_DEPENDENCY_IMAGE_LOCK_REFS[${id}]+x}" ]]; then
    die "missing required build base image lock entry: ${id}"
  fi

  printf '%s' "${BASE_DEPENDENCY_IMAGE_LOCK_REFS[${id}]}"
}

require_current_p2_base_dependency_image_lock_entries() {
  local required_id=""

  for required_id in app_node_base_image app_mc_image llmup_rust_base_image llmup_runtime_base_image; do
    locked_image_ref_or_die "${required_id}" >/dev/null
  done
}

resolve_base_image_ref() {
  local env_name="$1"
  local lock_id="$2"
  local override_value="${!env_name:-}"

  if [[ -n "${override_value}" ]]; then
    validate_image_ref_pinned_non_latest "base image override ${env_name}" "${override_value}"
    printf '%s' "${override_value}"
    return 0
  fi

  locked_image_ref_or_die "${lock_id}"
}

load_base_dependency_image_lock "${BASE_DEPENDENCY_IMAGE_LOCK}"
require_current_p2_base_dependency_image_lock_entries

K8S_REGISTRY_HOST="${K8S_REGISTRY_HOST:-${REGISTRY_HOST}}"

APP_SOURCE_DIR="${RELEASE_ROOT}/sources/agentsmith"
SANDBOX_SOURCE_DIR="${RELEASE_ROOT}/sources/mbos-sandbox-v1/manager-service"
UNIVERSAL_PROXY_SOURCE_DIR="${RELEASE_ROOT}/sources/llm-universal-proxy"
APP_SOURCE_DIR="${APP_SOURCE_DIR_OVERRIDE:-${APP_SOURCE_DIR}}"
SANDBOX_SOURCE_DIR="${SANDBOX_SOURCE_DIR_OVERRIDE:-${SANDBOX_SOURCE_DIR}}"
UNIVERSAL_PROXY_SOURCE_DIR="${UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE:-${UNIVERSAL_PROXY_SOURCE_DIR}}"

[[ -d "${APP_SOURCE_DIR}" ]] || die "missing bundled agentsmith source at ${APP_SOURCE_DIR}"
[[ -d "${SANDBOX_SOURCE_DIR}" ]] || die "missing bundled sandbox manager source at ${SANDBOX_SOURCE_DIR}"
[[ -d "${UNIVERSAL_PROXY_SOURCE_DIR}" ]] || die "missing bundled universal proxy source at ${UNIVERSAL_PROXY_SOURCE_DIR}"

IMAGE_PREFIX="${REGISTRY_HOST}/${REGISTRY_PROJECT}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-v1.15.1}"

APP_BASE_IMAGE="agentsmith-app-base:${RELEASE_ID}"
RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE:-$(runner_release_base_image notebook "${RELEASE_ID}")}"
CHAT_RUNNER_BASE_IMAGE="${CHAT_RUNNER_BASE_IMAGE:-$(runner_release_base_image chat "${RELEASE_ID}")}"
VERIFY_RUNNER_BASE_IMAGE="agentsmith-verify-runner-base:${RELEASE_ID}"
APP_IMAGE="${IMAGE_PREFIX}/agentsmith-app:${RELEASE_ID}"
RUNNER_IMAGE="${RUNNER_IMAGE:-$(runner_release_image notebook "${RELEASE_ID}" "${IMAGE_PREFIX}")}"
CHAT_RUNNER_IMAGE="${CHAT_RUNNER_IMAGE:-$(runner_release_image chat "${RELEASE_ID}" "${IMAGE_PREFIX}")}"
VERIFY_RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-verify-runner:${RELEASE_ID}"
SANDBOX_MANAGER_IMAGE="${IMAGE_PREFIX}/sandbox-manager:${RELEASE_ID}"
UNIVERSAL_PROXY_IMAGE="${IMAGE_PREFIX}/llm-universal-proxy:${RELEASE_ID}"

APP_NODE_BASE_IMAGE="$(resolve_base_image_ref APP_NODE_BASE_IMAGE app_node_base_image)"
APP_MC_IMAGE="$(resolve_base_image_ref APP_MC_IMAGE app_mc_image)"
RUNNER_NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE:-node:24.14.1-bookworm}"
VERIFY_PLAYWRIGHT_BASE_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE:-mcr.microsoft.com/playwright:v1.58.1-noble}"
VERIFY_DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE:-docker:28.5.1-cli}"
SANDBOX_GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE:-golang:1.25-alpine}"
SANDBOX_RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE:-ubuntu:22.04}"
UNIVERSAL_PROXY_RUST_BASE_IMAGE="$(resolve_base_image_ref UNIVERSAL_PROXY_RUST_BASE_IMAGE llmup_rust_base_image)"
UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE="$(resolve_base_image_ref UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE llmup_runtime_base_image)"

run_build_artifact_broker_prebuild_plan() {
  local broker_cli="${ROOT_DIR}/scripts/governance/build-artifact-broker-cli.ts"
  local broker_runner=()
  local broker_exit=0
  local plan_path="${RELEASE_ROOT}/build-artifact-broker-plan.json"
  local plan_env_path="${RELEASE_ROOT}/build-artifact-broker-plan.env"

  if [[ ! -f "${broker_cli}" ]]; then
    die "build artifact broker prebuild plan failed: missing internal adapter at ${broker_cli}"
  fi

  if [[ -n "${BUILD_ARTIFACT_BROKER_TSX_COMMAND:-}" ]]; then
    broker_runner=("${BUILD_ARTIFACT_BROKER_TSX_COMMAND}")
  elif [[ -x "${ROOT_DIR}/node_modules/.bin/tsx" ]]; then
    broker_runner=("${ROOT_DIR}/node_modules/.bin/tsx")
  elif command -v tsx >/dev/null 2>&1; then
    broker_runner=("$(command -v tsx)")
  else
    die "build artifact broker prebuild plan failed: missing tsx runtime"
  fi

  "${broker_runner[@]}" "${broker_cli}" \
    --artifact-kind prebuild-plan \
    --release-root "${RELEASE_ROOT}" \
    --release-id "${RELEASE_ID}" \
    --app-source-dir "${APP_SOURCE_DIR}" \
    --llmup-source-dir "${UNIVERSAL_PROXY_SOURCE_DIR}" \
    --app-image "${APP_IMAGE}" \
    --llmup-image "${UNIVERSAL_PROXY_IMAGE}" \
    --app-base-image "${APP_NODE_BASE_IMAGE}" \
    --app-base-image "${APP_MC_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" \
    --plan-path "${plan_path}" || broker_exit=$?

  if [[ "${broker_exit}" -ne 0 ]]; then
    die "build artifact broker prebuild plan failed with exit ${broker_exit}; see ${RELEASE_ROOT}/build-artifact-broker-report.json"
  fi
  [[ -f "${plan_path}" ]] || die "build artifact broker prebuild plan did not write ${plan_path}"
  command -v node >/dev/null 2>&1 || die "missing node runtime required to read build artifact broker prebuild plan"

  node - "${plan_path}" > "${plan_env_path}" <<'NODE'
const fs = require('node:fs');

const planPath = process.argv[2];
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

function readTarget(targetName) {
  if (!Array.isArray(plan.targets)) {
    throw new Error('prebuild plan targets must be an array');
  }
  const target = plan.targets.find((entry) => entry && entry.target === targetName);
  if (!target) {
    throw new Error(`prebuild plan is missing target ${targetName}`);
  }
  return target;
}

function requireString(target, field) {
  const value = target[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`prebuild plan target ${target.target}.${field} must be a non-empty string`);
  }
  return value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function emit(name, value) {
  process.stdout.write(`${name}=${shellQuote(value)}\n`);
}

function emitTarget(prefix, target) {
  emit(`${prefix}_CONTENT_REF`, requireString(target, 'content_ref'));
  emit(`${prefix}_RELEASE_ALIAS_REF`, requireString(target, 'release_alias_ref'));
  emit(`${prefix}_INPUT_DIGEST`, requireString(target, 'input_digest'));
  emit(`${prefix}_BASE_IMAGE_DIGEST`, requireString(target, 'base_image_digest'));
  emit(`${prefix}_CONTENT_KEY`, requireString(target, 'content_key'));
  emit(`${prefix}_PRODUCER`, requireString(target.producer ?? {}, 'name'));
}

emitTarget('APP', readTarget('app'));
emitTarget('LLMUP', readTarget('llmup'));
NODE

  # shellcheck disable=SC1090
  source "${plan_env_path}"

  APP_IMAGE="${APP_RELEASE_ALIAS_REF}"
  UNIVERSAL_PROXY_IMAGE="${LLMUP_RELEASE_ALIAS_REF}"
}

run_build_artifact_broker_prebuild_plan

docker_build_local \
  --build-arg NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE}" \
  -t "${APP_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" \
  "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" \
  --build-arg NODE_RUNTIME_IMAGE="${APP_NODE_BASE_IMAGE}" \
  --build-arg MC_IMAGE="${APP_MC_IMAGE}" \
  --label "com.agentsmith.build.input_digest=${APP_INPUT_DIGEST}" \
  --label "com.agentsmith.build.base_image_digest=${APP_BASE_IMAGE_DIGEST}" \
  --label "com.agentsmith.build.content_key=${APP_CONTENT_KEY}" \
  --label "com.agentsmith.build.release_id=${RELEASE_ID}" \
  --label "com.agentsmith.build.target=app" \
  --label "com.agentsmith.build.producer=${APP_PRODUCER}" \
  -t "${APP_CONTENT_REF}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app" \
  "${APP_SOURCE_DIR}"
docker tag "${APP_CONTENT_REF}" "${APP_RELEASE_ALIAS_REF}"
build_runner_image notebook "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY:-}" "1" "1" "${APP_SOURCE_DIR}"
build_runner_image chat "${CHAT_RUNNER_BASE_IMAGE}" "${CHAT_RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY:-}" "1" "1" "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg PLAYWRIGHT_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE}" \
  --build-arg DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE}" \
  -t "${VERIFY_RUNNER_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" \
  "${APP_SOURCE_DIR}"
docker_build_local --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE}" \
  -t "${SANDBOX_MANAGER_IMAGE}" \
  -f "${SANDBOX_SOURCE_DIR}/Dockerfile" \
  "${SANDBOX_SOURCE_DIR}"
docker_build_local \
  --build-arg RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" \
  --label "com.agentsmith.build.input_digest=${LLMUP_INPUT_DIGEST}" \
  --label "com.agentsmith.build.base_image_digest=${LLMUP_BASE_IMAGE_DIGEST}" \
  --label "com.agentsmith.build.content_key=${LLMUP_CONTENT_KEY}" \
  --label "com.agentsmith.build.release_id=${RELEASE_ID}" \
  --label "com.agentsmith.build.target=llmup" \
  --label "com.agentsmith.build.producer=${LLMUP_PRODUCER}" \
  -t "${LLMUP_CONTENT_REF}" \
  -f "${UNIVERSAL_PROXY_SOURCE_DIR}/Dockerfile" \
  "${UNIVERSAL_PROXY_SOURCE_DIR}"
docker tag "${LLMUP_CONTENT_REF}" "${LLMUP_RELEASE_ALIAS_REF}"

cat > "${RELEASE_ROOT}/VERSION" <<EOF
release_id=${RELEASE_ID}
agentsmith_app_image=${APP_IMAGE}
agentsmith_runner_image=${RUNNER_IMAGE}
agentsmith_runner_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/agentsmith-notebook-codex-runner:${RELEASE_ID}
agentsmith_chat_runner_image=${CHAT_RUNNER_IMAGE}
agentsmith_chat_runner_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/agentsmith-chat-llm-runner:${RELEASE_ID}
agentsmith_verify_runner_image=${VERIFY_RUNNER_IMAGE}
sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}
sandbox_manager_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/sandbox-manager:${RELEASE_ID}
llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}
app_node_base_image_ref=${APP_NODE_BASE_IMAGE}
app_mc_image_ref=${APP_MC_IMAGE}
llmup_rust_base_image_ref=${UNIVERSAL_PROXY_RUST_BASE_IMAGE}
llmup_runtime_base_image_ref=${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}
juicefs_csi_version=${JUICEFS_CSI_VERSION}
ingress_nginx_version=${INGRESS_NGINX_VERSION}
registry_host=${REGISTRY_HOST}
k8s_registry_host=${K8S_REGISTRY_HOST}
registry_project=${REGISTRY_PROJECT}
EOF

run_build_artifact_broker_manifest_gate() {
  local broker_cli="${ROOT_DIR}/scripts/governance/build-artifact-broker-cli.ts"
  local broker_runner=()
  local broker_exit=0
  local manifest_path="${RELEASE_ROOT}/build-manifest.json"
  local report_path="${RELEASE_ROOT}/build-artifact-broker-report.json"

  if [[ ! -f "${broker_cli}" ]]; then
    die "build artifact broker manifest gate failed: missing internal adapter at ${broker_cli}"
  fi

  if [[ -n "${BUILD_ARTIFACT_BROKER_TSX_COMMAND:-}" ]]; then
    broker_runner=("${BUILD_ARTIFACT_BROKER_TSX_COMMAND}")
  elif [[ -x "${ROOT_DIR}/node_modules/.bin/tsx" ]]; then
    broker_runner=("${ROOT_DIR}/node_modules/.bin/tsx")
  elif command -v tsx >/dev/null 2>&1; then
    broker_runner=("$(command -v tsx)")
  else
    die "build artifact broker manifest gate failed: missing tsx runtime"
  fi

  "${broker_runner[@]}" "${broker_cli}" \
    --release-root "${RELEASE_ROOT}" \
    --release-id "${RELEASE_ID}" \
    --app-source-dir "${APP_SOURCE_DIR}" \
    --llmup-source-dir "${UNIVERSAL_PROXY_SOURCE_DIR}" \
    --app-image "${APP_IMAGE}" \
    --llmup-image "${UNIVERSAL_PROXY_IMAGE}" \
    --app-base-image "${APP_NODE_BASE_IMAGE}" \
    --app-base-image "${APP_MC_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" || broker_exit=$?

  if [[ "${broker_exit}" -ne 0 ]]; then
    die "build artifact broker manifest gate failed with exit ${broker_exit}; see ${report_path}"
  fi

  if [[ -f "${report_path}" ]]; then
    die "build artifact broker manifest gate wrote diagnostic report instead of trusted manifest: ${report_path}"
  fi
  [[ -f "${manifest_path}" ]] || die "build artifact broker manifest gate did not write ${manifest_path}"

  log "build artifact broker manifest: ${manifest_path}"
}

run_build_artifact_broker_manifest_gate

log "build-images ok"
