#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env

bash "${ROOT_DIR}/scripts/demo-deploy/reset.sh" || true
release_scenario_lock "${DEMO_REHEARSAL_NAME}"

printf '[demo-rehearsal] down\n'
