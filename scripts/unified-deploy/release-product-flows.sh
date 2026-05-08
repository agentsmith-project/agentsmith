#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "${ROOT_DIR}/scripts/unified-deploy/release-env.sh"

mkdir -p "$(unified_deploy_release_evidence_dir product-flows)"

exec npm run test:unified-deploy:product-flows -- \
  --evidence-dir="$(unified_deploy_release_evidence_dir product-flows)" \
  --site-env="$(unified_deploy_release_site_env)" \
  --flow=workspace_project \
  --flow=files \
  --flow=agent_task_managed_runner \
  --agent-task-polls="${UNIFIED_DEPLOY_AGENT_TASK_POLLS:-30}" \
  --agent-task-poll-interval-ms="${UNIFIED_DEPLOY_AGENT_TASK_POLL_INTERVAL_MS:-2000}"
