#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/artifact-generation-common.sh"
RUN_ID="${DOC_ARTIFACTS_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
OUTPUT_DIR="${DOC_ARTIFACTS_OUTPUT_DIR:-${ROOT_DIR}/artifacts/product-docs/${RUN_ID}}"

artifact_log "doc-artifacts" "run id: ${RUN_ID}"
artifact_log "doc-artifacts" "output: ${OUTPUT_DIR}"

cd "${ROOT_DIR}"
NEXT_PUBLIC_DOC_FIXTURES=true \
DOC_ARTIFACTS_OUTPUT_DIR="${OUTPUT_DIR}" \
bash scripts/run-mock-lane-playwright.sh e2e/doc-artifacts.spec.ts --project=doc-artifacts --workers=1 "$@"

artifact_log "doc-artifacts" "done"
artifact_log "doc-artifacts" "index: ${OUTPUT_DIR}/index.md"
