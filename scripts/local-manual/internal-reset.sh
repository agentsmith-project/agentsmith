#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

stop_internal_runtime
AFSCP_ENVIRONMENT=local-real reset_owned_afscp_local_runtime_for_gate
rm -rf "${INTERNAL_REAL_DIR}"

bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"
