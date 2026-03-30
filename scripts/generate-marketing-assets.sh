#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/artifact-generation-common.sh"
OUTPUT_DIR="${MARKETING_ASSETS_OUTPUT_DIR:-${ROOT_DIR}/marketing/screenshots}"
TMP_DIR="${ROOT_DIR}/test-results/marketing-screenshots"

artifact_log "marketing-assets" "temp output: ${TMP_DIR}"
artifact_log "marketing-assets" "final output: ${OUTPUT_DIR}"

artifact_prepare_dir "${TMP_DIR}"

cd "${ROOT_DIR}"
MARKETING_ASSETS_OUTPUT_DIR="${TMP_DIR}" \
playwright test e2e/capture-screenshots.spec.ts --project=marketing-assets --workers=1 "$@"

artifact_sync_dir "${TMP_DIR}" "${OUTPUT_DIR}"

artifact_log "marketing-assets" "done"
artifact_log "marketing-assets" "refreshed: ${OUTPUT_DIR}"
