#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

bash "${ROOT_DIR}/scripts/cluster-deploy/prepare.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/publish-images.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/upgrade-app.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/upgrade-sandbox.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/upgrade-status.sh"

