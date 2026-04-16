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
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
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
const {
  buildVisualBaselineScenarioEvidence,
  groupVisualBaselineCatalogByScenario,
  readVisualBaselineBuildRecord,
} = supportModule;

function resolveGitSha() {
  try {
    return execFileSync("git", ["-C", rootDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

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
  const lane = "mock-lane";
  return {
    lane,
    runId,
    gitSha: resolveGitSha() || "unknown",
    fingerprint: process.env.VISUAL_BASELINE_BUILD_FINGERPRINT?.trim()
      || `${runId}:${lane}:visual`,
    startedAt: new Date().toISOString(),
  };
}

function normalizeManifestActualUrl(route) {
  return new URL(route, "http://agentsmith.visual.local").pathname;
}

function writeManifest(manifest) {
  writeFileSync(join(evidenceDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const build = resolveBuild();
const reviewRoot = process.env.VISUAL_BASELINE_REVIEW_ROOT?.trim()
  || join(rootDir, "artifacts", "visual-baseline-reviews");
const sourceManifestPath = join(reviewRoot, build.runId, "run-manifest.json");
const targetManifestPath = join(evidenceDir, "run-manifest.json");

if (existsSync(sourceManifestPath)) {
  copyFileSync(sourceManifestPath, targetManifestPath);
} else if (buildInfoFile) {
  throw new Error(`missing lane-visual run manifest: ${sourceManifestPath}`);
} else {
  const scenarios = [...groupVisualBaselineCatalogByScenario().values()]
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
    .map((scenario) => {
      const evidence = buildVisualBaselineScenarioEvidence(scenario);
      return {
        scenario_id: scenario.scenarioId,
        actual_url: normalizeManifestActualUrl(scenario.route),
        story_fingerprint: evidence.storyFingerprint,
        screenshots: evidence.screenshots.map((entry) => ({
          file_name: entry.fileName,
          actual_sha256: `sha256:${entry.screenshotSha256}`,
          baseline_sha256: `sha256:${entry.baselineSha256}`,
        })),
      };
    });

  writeManifest({
    schema: "visual_baseline_run_manifest/v1",
    run_id: build.runId,
    build: {
      lane: build.lane,
      run_id: build.runId,
      git_sha: build.gitSha,
      fingerprint: build.fingerprint,
      started_at: build.startedAt,
    },
    scenarios,
  });
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
