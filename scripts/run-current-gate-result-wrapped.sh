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
export CURRENT_GATE_RESULT_RUN_ID="${RUN_ID}"
export CURRENT_GATE_RESULT_EVIDENCE_DIR="${EVIDENCE_DIR}"
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
const governance = await import(pathToFileURL(join(rootDir, "scripts/governance/release-campaign-io.ts")).href);
const governanceModule = governance.default ?? governance;
const { readVisualBaselineRunManifestArtifact } = governanceModule;

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
const requiredCompleteness = "require_full_catalog";

function isSafeRelativeFilePath(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").includes("..");
}

if (existsSync(sourceManifestPath)) {
  const validation = readVisualBaselineRunManifestArtifact({
    path: sourceManifestPath,
    expectedRunId: build.runId,
    requiredCompleteness,
  });
  if (!validation.ok) {
    process.stderr.write(`${validation.failureClass}::${validation.message}\n`);
    process.exit(1);
  }
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
  process.stderr.write(`evidence_missing::missing lane-visual run manifest: ${sourceManifestPath}\n`);
  process.exit(1);
}
NODE
}

gate_current_run_diagnostics_timestamp() {
  node -e 'const now = new Date(); process.stdout.write(`${now.toISOString()} ${now.getTime()}`);'
}

gate_write_wrapped_run_diagnostics() {
  local action="$1"
  local event="${2:-}"
  local reason_code="${3:-}"
  local failure_reason="${4:-}"
  local finished_at="${5:-}"
  local finished_ms="${6:-}"

  CURRENT_RUN_DIAGNOSTICS_ACTION="${action}" \
  CURRENT_RUN_DIAGNOSTICS_RUN_ROOT="${EVIDENCE_DIR}" \
  CURRENT_RUN_DIAGNOSTICS_RUN_ID="${RUN_ID}" \
  CURRENT_RUN_DIAGNOSTICS_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID}" \
  CURRENT_RUN_DIAGNOSTICS_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND}" \
  CURRENT_RUN_DIAGNOSTICS_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT}" \
  CURRENT_RUN_DIAGNOSTICS_CI_JOB="${CURRENT_GATE_RESULT_CI_JOB}" \
  CURRENT_RUN_DIAGNOSTICS_STAGE="execute" \
  CURRENT_RUN_DIAGNOSTICS_EVENT="${event}" \
  CURRENT_RUN_DIAGNOSTICS_REASON_CODE="${reason_code}" \
  CURRENT_RUN_DIAGNOSTICS_FAILURE_REASON="${failure_reason}" \
  CURRENT_RUN_DIAGNOSTICS_STARTED_AT="${RUN_DIAGNOSTICS_STARTED_AT:-}" \
  CURRENT_RUN_DIAGNOSTICS_STARTED_MS="${RUN_DIAGNOSTICS_STARTED_MS:-}" \
  CURRENT_RUN_DIAGNOSTICS_FINISHED_AT="${finished_at}" \
  CURRENT_RUN_DIAGNOSTICS_FINISHED_MS="${finished_ms}" \
  node --import tsx "${ROOT_DIR}/scripts/governance/run-diagnostics-writer.ts"
}

gate_write_wrapped_run_diagnostics_finish() {
  local event="$1"
  local reason_code="$2"
  local failure_reason="$3"
  local diagnostic_now
  local finished_at
  local finished_ms

  if diagnostic_now="$(gate_current_run_diagnostics_timestamp)"; then
    finished_at="${diagnostic_now% *}"
    finished_ms="${diagnostic_now##* }"
  else
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    finished_ms="${RUN_DIAGNOSTICS_STARTED_MS:-0}"
  fi
  gate_write_wrapped_run_diagnostics "wrapped-command-finish" "${event}" "${reason_code}" "${failure_reason}" "${finished_at}" "${finished_ms}"
}

RUN_DIAGNOSTICS_STARTED_AT=""
RUN_DIAGNOSTICS_STARTED_MS=""
if diagnostic_now="$(gate_current_run_diagnostics_timestamp)"; then
  RUN_DIAGNOSTICS_STARTED_AT="${diagnostic_now% *}"
  RUN_DIAGNOSTICS_STARTED_MS="${diagnostic_now##* }"
else
  RUN_DIAGNOSTICS_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  RUN_DIAGNOSTICS_STARTED_MS="0"
fi
if ! gate_write_wrapped_run_diagnostics "wrapped-command-start"; then
  printf '[current-gate-result] warning: failed to write run diagnostics start artifact\n' >&2
fi

set +e
"$@"
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  if [[ "${GATE_ID}" == "lane-visual" ]]; then
    validation_log="$(mktemp)"
    if ! gate_write_visual_run_manifest "${EVIDENCE_DIR}" 2>"${validation_log}"; then
      validation_error="$(tail -n 1 "${validation_log}" || true)"
      rm -f "${validation_log}"
      validation_failure_class="contract_drift"
      validation_summary="lane-visual evidence validation failed"
      if [[ "${validation_error}" == evidence_missing::* ]]; then
        validation_failure_class="evidence_missing"
        validation_summary="${validation_error#evidence_missing::}"
      elif [[ "${validation_error}" == contract_drift::* ]]; then
        validation_summary="${validation_error#contract_drift::}"
      elif [[ -n "${validation_error}" ]]; then
        validation_summary="${validation_error}"
      fi
      if ! gate_write_wrapped_run_diagnostics_finish "failed" "" "wrapped_evidence_validation_failed"; then
        printf '[current-gate-result] warning: failed to write run diagnostics validation-failure artifact\n' >&2
      fi
      gate_record_failure "${EVIDENCE_DIR}" "${validation_failure_class}" "evidence" "${validation_summary}"
      exit 1
    fi
    rm -f "${validation_log}"
  fi
  if ! gate_write_wrapped_run_diagnostics_finish "finished" "wrapped_command_completed" ""; then
    printf '[current-gate-result] warning: failed to write run diagnostics finish artifact\n' >&2
  fi
  gate_record_success "${EVIDENCE_DIR}" "${LINE_KIND}"
  exit 0
fi

if ! gate_write_wrapped_run_diagnostics_finish "failed" "" "wrapped_command_exited_nonzero"; then
  printf '[current-gate-result] warning: failed to write run diagnostics failure artifact\n' >&2
fi
gate_record_failure "${EVIDENCE_DIR}" "${CURRENT_GATE_RESULT_FAILURE_CLASSIFICATION:-scenario_assertion_failed}" "execute" "wrapped command exited with status ${status}"
exit "${status}"
