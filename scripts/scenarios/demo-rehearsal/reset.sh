#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
acquire_scenario_lock "${DEMO_REHEARSAL_NAME}"

bash "${ROOT_DIR}/scripts/demo-deploy/reset.sh"
release_scenario_lock "${DEMO_REHEARSAL_NAME}"

printf '[demo-rehearsal] reset complete\n'
