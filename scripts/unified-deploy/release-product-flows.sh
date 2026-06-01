#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/unified-deploy/release-env.sh"

PRODUCT_FLOWS_EVIDENCE_DIR="$(unified_deploy_release_evidence_dir product-flows)"
POST_DEPLOY_PRODUCT_SMOKE_ROOT="${RELEASE_CAMPAIGN_ROOT:-${UNIFIED_DEPLOY_RELEASE_ROOT_DIR:-${ROOT_DIR}/artifacts}}"
POST_DEPLOY_PRODUCT_SMOKE_DIR="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}/post-deploy-product-smoke"
POST_DEPLOY_PRODUCT_SMOKE_PATH_ROOT="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}"
POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT="$(unified_deploy_release_contract)"

if ! test -f "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT}"; then
  printf '[post-deploy-product-smoke] release contract is required before product flows: %s\n' "${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT}" >&2
  exit 1
fi

mkdir -p "${PRODUCT_FLOWS_EVIDENCE_DIR}" "${POST_DEPLOY_PRODUCT_SMOKE_DIR}"
product_flow_log="$(mktemp)"
trap 'rm -f "${product_flow_log}"' EXIT

product_flow_status=0
npm run test:unified-deploy:product-flows -- \
  --evidence-dir="${PRODUCT_FLOWS_EVIDENCE_DIR}" \
  --site-env="$(unified_deploy_release_site_env)" \
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
  --release-contract="${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT}" \
  --output-dir="${POST_DEPLOY_PRODUCT_SMOKE_DIR}" \
  --path-root="${POST_DEPLOY_PRODUCT_SMOKE_PATH_ROOT}"
