#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

run_mode() {
  local mode="$1"
  printf '[demo-modes-gate] mode=%s\n' "${mode}"
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-down.sh" >/dev/null 2>&1 || true
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-reset.sh" >/dev/null 2>&1 || true
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-up.sh"
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-bootstrap.sh"
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-verify.sh"
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-report.sh"
  FLOW_SITE_ENV_DEMO_DEPLOY_MODE="${mode}" bash "${ROOT_DIR}/scripts/demo-rehearsal-down.sh"
}

run_mode simple
run_mode full

printf '[demo-modes-gate] ok\n'
