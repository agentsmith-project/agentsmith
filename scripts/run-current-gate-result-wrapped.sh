#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

if [[ "$#" -lt 5 || "$4" != "--" ]]; then
  cat >&2 <<'EOF'
usage: scripts/run-current-gate-result-wrapped.sh <gate-id> <line-kind> <npm-script> -- <command> [args...]
EOF
  exit 2
fi

GATE_ID="$1"
LINE_KIND="$2"
NPM_SCRIPT="$3"
shift 4

RUN_ID="${CURRENT_GATE_RESULT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${CURRENT_GATE_RESULT_EVIDENCE_DIR:-${ROOT_DIR}/artifacts/gate-results/${GATE_ID}/${RUN_ID}}"
export CURRENT_GATE_RESULT_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-${GATE_ID}}"
export CURRENT_GATE_RESULT_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-${NPM_SCRIPT}}"
export CURRENT_GATE_RESULT_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-${LINE_KIND}}"
export CURRENT_GATE_RESULT_CI_JOB="${CURRENT_GATE_RESULT_CI_JOB:-$(gate_resolve_result_ci_job "${CURRENT_GATE_RESULT_GATE_ID}")}"
if [[ "${GATE_ID}" == "lane-visual" && -z "${MOCK_RUN_ID:-}" ]]; then
  export MOCK_RUN_ID="${RUN_ID}"
fi

gate_evidence_init "${EVIDENCE_DIR}" "${LINE_KIND}"
gate_record_task_summary "${EVIDENCE_DIR}" "{\"line_kind\":\"${LINE_KIND}\",\"gate_id\":\"${GATE_ID}\",\"npm_script\":\"${NPM_SCRIPT}\"}"

gate_write_visual_run_manifest() {
  local evidence_dir="$1"
  local build_info_file="${VISUAL_BASELINE_BUILD_INFO_FILE:-${VISUAL_BUILD_INFO_FILE:-}}"

  CURRENT_GATE_RESULT_ROOT_DIR="${ROOT_DIR}" \
  CURRENT_GATE_RESULT_EVIDENCE_DIR="${evidence_dir}" \
  CURRENT_GATE_RESULT_RUN_ID="${RUN_ID}" \
  CURRENT_GATE_RESULT_VISUAL_BUILD_INFO_FILE="${build_info_file}" \
  node --input-type=module --import tsx <<'NODE'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.env.CURRENT_GATE_RESULT_ROOT_DIR?.trim();
const evidenceDir = process.env.CURRENT_GATE_RESULT_EVIDENCE_DIR?.trim();
const fallbackRunId = process.env.CURRENT_GATE_RESULT_RUN_ID?.trim();
const buildInfoFile = process.env.CURRENT_GATE_RESULT_VISUAL_BUILD_INFO_FILE?.trim() || "";

if (!rootDir || !evidenceDir || !fallbackRunId) {
  throw new Error("missing visual run-manifest context");
}

const support = await import(pathToFileURL(join(rootDir, "e2e/visual-baseline-support.ts")).href);
const supportModule = support.default ?? support;
const { readVisualBaselineBuildRecord } = supportModule;

function resolveBuild() {
  if (buildInfoFile) {
    if (!existsSync(buildInfoFile)) {
      throw new Error(`missing visual build info file: ${buildInfoFile}`);
    }
    return readVisualBaselineBuildRecord(buildInfoFile);
  }

  const runId = process.env.MOCK_RUN_ID?.trim()
    || process.env.RELEASE_CAMPAIGN_RUN_ID?.trim()
    || fallbackRunId;
  return {
    runId,
  };
}

const build = resolveBuild();
const reviewRoot = process.env.VISUAL_BASELINE_REVIEW_ROOT?.trim()
  || join(rootDir, "artifacts", "visual-baseline-reviews");
const sourceManifestPath = join(reviewRoot, build.runId, "run-manifest.json");
const targetManifestPath = join(evidenceDir, "run-manifest.json");

function isSafeRelativeFilePath(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").includes("..");
}

if (existsSync(sourceManifestPath)) {
  copyFileSync(sourceManifestPath, targetManifestPath);
  const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  const screenshots = Array.isArray(manifest?.scenarios)
    ? manifest.scenarios.flatMap((scenario) => Array.isArray(scenario?.screenshots) ? scenario.screenshots : [])
    : [];
  for (const screenshot of screenshots) {
    const actualRelPath = typeof screenshot?.actual_relpath === "string" ? screenshot.actual_relpath : null;
    if (!actualRelPath || !isSafeRelativeFilePath(actualRelPath)) {
      throw new Error(`invalid lane-visual actual capture path: ${String(actualRelPath)}`);
    }
    const sourceCapturePath = join(reviewRoot, build.runId, actualRelPath);
    const targetCapturePath = join(evidenceDir, actualRelPath);
    if (!existsSync(sourceCapturePath)) {
      throw new Error(`missing lane-visual actual capture: ${sourceCapturePath}`);
    }
    mkdirSync(dirname(targetCapturePath), { recursive: true });
    copyFileSync(sourceCapturePath, targetCapturePath);
  }
} else {
  throw new Error(`missing lane-visual run manifest: ${sourceManifestPath}`);
}
NODE
}

set +e
"$@"
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  if [[ "${GATE_ID}" == "lane-visual" ]]; then
    gate_write_visual_run_manifest "${EVIDENCE_DIR}"
  fi
  gate_record_success "${EVIDENCE_DIR}" "${LINE_KIND}"
  exit 0
fi

gate_record_failure "${EVIDENCE_DIR}" "${CURRENT_GATE_RESULT_FAILURE_CLASSIFICATION:-scenario_assertion_failed}" "execute" "wrapped command exited with status ${status}"
exit "${status}"
