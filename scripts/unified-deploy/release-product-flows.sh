#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/unified-deploy/release-env.sh"

PRODUCT_FLOWS_EVIDENCE_DIR="$(unified_deploy_release_evidence_dir product-flows)"
POST_DEPLOY_PRODUCT_SMOKE_ROOT="${RELEASE_CAMPAIGN_ROOT:-${UNIFIED_DEPLOY_RELEASE_ROOT_DIR:-${ROOT_DIR}/artifacts}}"
POST_DEPLOY_PRODUCT_SMOKE_DIR="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}/post-deploy-product-smoke"
POST_DEPLOY_PRODUCT_SMOKE_PATH_ROOT="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}"
POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE="$(unified_deploy_release_contract)"
POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET="$(unified_deploy_release_contract_target)"
POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_SOURCE="$(unified_deploy_release_site_env)"
POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}/deployment-target/site.env"
POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE="$(unified_deploy_release_substrate_truth)"
POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}/deployment-target/substrate-truth.json"
POST_DEPLOY_PRODUCT_SMOKE_RUNTIME_SUBSTRATE_ENV_SOURCE="${UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV:-}"

if ! test -f "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE}"; then
  printf '[post-deploy-product-smoke] release contract is required before product flows.\n' >&2
  printf '[post-deploy-product-smoke] resolved source: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE}" >&2
  printf '[post-deploy-product-smoke] set UNIFIED_DEPLOY_RELEASE_CONTRACT or AGENTSMITH_RELEASE_CONTRACT_PATH, or place the artifact at: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}" >&2
  exit 1
fi

if ! test -f "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_SOURCE}"; then
  printf '[post-deploy-product-smoke] deployed target site env is required for release handoff.\n' >&2
  printf '[post-deploy-product-smoke] resolved source: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_SOURCE}" >&2
  printf '[post-deploy-product-smoke] set UNIFIED_DEPLOY_RELEASE_SITE_ENV=<path>.\n' >&2
  exit 1
fi

if [[ -z "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE}" ]] || ! test -f "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE}"; then
  printf '[post-deploy-product-smoke] deployed target substrate truth is required for release handoff.\n' >&2
  printf '[post-deploy-product-smoke] resolved source: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE:-<unset>}" >&2
  printf '[post-deploy-product-smoke] set UNIFIED_DEPLOY_RELEASE_SUBSTRATE_TRUTH=<path>.\n' >&2
  exit 1
fi

runtime_substrate_env_args=()
if [[ -n "${POST_DEPLOY_PRODUCT_SMOKE_RUNTIME_SUBSTRATE_ENV_SOURCE}" ]]; then
  if ! test -f "${POST_DEPLOY_PRODUCT_SMOKE_RUNTIME_SUBSTRATE_ENV_SOURCE}"; then
    printf '[post-deploy-product-smoke] runtime-only product-flow substrate env projection path is not readable.\n' >&2
    printf '[post-deploy-product-smoke] resolved source: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_RUNTIME_SUBSTRATE_ENV_SOURCE}" >&2
    printf '[post-deploy-product-smoke] set UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV=<path>, or provide UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE / SUBSTRATE_* request env.\n' >&2
    exit 1
  fi
  runtime_substrate_env_args+=("--runtime-substrate-env=${POST_DEPLOY_PRODUCT_SMOKE_RUNTIME_SUBSTRATE_ENV_SOURCE}")
fi

project_airgap_managed_runner_image() {
  local image_map_path
  image_map_path="$(dirname "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE}")/image-map.json"
  POST_DEPLOY_PRODUCT_SMOKE_IMAGE_MAP_PATH="${image_map_path}" \
  POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET="${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}" \
  node <<'NODE'
const fs = require('node:fs');

const siteEnvPath = process.env.POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET;
const imageMapPath = process.env.POST_DEPLOY_PRODUCT_SMOKE_IMAGE_MAP_PATH;
if (!siteEnvPath) {
  process.exit(0);
}

const siteEnv = fs.readFileSync(siteEnvPath, 'utf8');
const profile = (siteEnv.match(/^UNIFIED_DEPLOY_PROFILE=(.*)$/m)?.[1] ?? '').trim();
if (!profile.split('/').includes('airgap')) {
  process.exit(0);
}

const imageMap = imageMapPath && fs.existsSync(imageMapPath)
  ? JSON.parse(fs.readFileSync(imageMapPath, 'utf8'))
  : undefined;
const mappings = Array.isArray(imageMap?.mappings) ? imageMap.mappings : [];
const managedRunnerMapping = mappings.find((entry) => (
  entry && typeof entry === 'object' && entry.id === 'managed_runner'
));
const mappedTargetImage = managedRunnerMapping?.target_image;
const legacyTargetImage = imageMap?.managed_runner?.target_image;
const targetImage = typeof mappedTargetImage === 'string' && mappedTargetImage.trim().length > 0
  ? mappedTargetImage
  : legacyTargetImage;
if (typeof targetImage !== 'string' || targetImage.trim().length === 0) {
  const currentRunnerImage = (siteEnv.match(/^MANAGED_RUNNER_IMAGE=(.*)$/m)?.[1] ?? '').trim();
  if (currentRunnerImage.startsWith('ghcr.io/')) {
    console.error(
      '[post-deploy-product-smoke] airgap MANAGED_RUNNER_IMAGE still points at ghcr.io, '
        + 'but no managed_runner target_image was found in components/image-map.json. '
        + 'Project the image-map target into the target site.env before product smoke.',
    );
    process.exit(1);
  }
  process.exit(0);
}

const projectedLine = `MANAGED_RUNNER_IMAGE=${targetImage.trim()}`;
const next = /^MANAGED_RUNNER_IMAGE=.*$/m.test(siteEnv)
  ? siteEnv.replace(/^MANAGED_RUNNER_IMAGE=.*$/m, projectedLine)
  : `${siteEnv.replace(/\s*$/u, '')}\n${projectedLine}\n`;
if (next !== siteEnv) {
  fs.writeFileSync(siteEnvPath, next);
}
NODE
}

mkdir -p "$(dirname "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}")"
if ! [[ -e "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}" && "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE}" -ef "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}" ]]; then
  cp "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_SOURCE}" "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}"
fi

mkdir -p "$(dirname "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}")"
if ! [[ -e "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}" && "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_SOURCE}" -ef "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}" ]]; then
  cp "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_SOURCE}" "${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}"
fi
if ! [[ -e "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET}" && "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE}" -ef "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET}" ]]; then
  cp "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_SOURCE}" "${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET}"
fi
project_airgap_managed_runner_image

npm run post-deploy-product-smoke:doctor -- \
  --release-contract="${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}" \
  --site-env="${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}" \
  --substrate-truth="${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET}" \
  "${runtime_substrate_env_args[@]}"

mkdir -p "${PRODUCT_FLOWS_EVIDENCE_DIR}" "${POST_DEPLOY_PRODUCT_SMOKE_DIR}"
product_flow_log="$(mktemp)"
trap 'rm -f "${product_flow_log}"' EXIT

product_flow_status=0
npm run test:unified-deploy:product-flows -- \
  --evidence-dir="${PRODUCT_FLOWS_EVIDENCE_DIR}" \
  --site-env="${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_TARGET}" \
  --substrate-truth="${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_TARGET}" \
  "${runtime_substrate_env_args[@]}" \
  --producer-command="npm run lane:unified-deploy:product-flows" \
  --agent-task-polls="${UNIFIED_DEPLOY_AGENT_TASK_POLLS:-30}" \
  --agent-task-poll-interval-ms="${UNIFIED_DEPLOY_AGENT_TASK_POLL_INTERVAL_MS:-2000}" \
  2>&1 | tee "${product_flow_log}" || product_flow_status="${PIPESTATUS[0]}"
if [[ "${product_flow_status}" -ne 0 ]]; then
  exit "${product_flow_status}"
fi

product_flows_path="$(sed -n 's/^.*--product-flows=//p' "${product_flow_log}" | tail -n 1)"
if [[ -z "${product_flows_path}" ]]; then
  printf '[post-deploy-product-smoke] missing product-flows aggregate path in producer output\n' >&2
  exit 1
fi

exec npm run post-deploy-product-smoke:report -- \
  --product-flows="${product_flows_path}" \
  --release-contract="${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_TARGET}" \
  --output-dir="${POST_DEPLOY_PRODUCT_SMOKE_DIR}" \
  --path-root="${POST_DEPLOY_PRODUCT_SMOKE_PATH_ROOT}"
