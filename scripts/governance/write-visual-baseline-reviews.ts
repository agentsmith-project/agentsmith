import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildVisualBaselineScenarioEvidence,
  groupVisualBaselineCatalogByScenario,
  readVisualBaselineBuildRecord,
  renderVisualBaselineAutomatedPassMarkdown,
  resolveVisualBaselineReviewDir,
  type VisualBaselineBuildRecord,
  type VisualBaselineScenarioRecord,
} from '../../e2e/visual-baseline-support';

function timestampRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function readRequiredBuildRecord(path: string | undefined): VisualBaselineBuildRecord {
  const normalizedPath = path?.trim();
  if (!normalizedPath) {
    throw new Error(
      'VISUAL_BASELINE_BUILD_INFO_FILE is required when writing visual baseline review artifacts. '
        + 'Run the official visual lane or provide the lane build metadata file explicitly.',
    );
  }
  return readVisualBaselineBuildRecord(normalizedPath);
}

function resolveReviewRoot(outputRoot: string | undefined): string {
  return resolve(outputRoot ?? process.env.VISUAL_BASELINE_REVIEW_ROOT ?? 'artifacts/visual-baseline-reviews');
}

function prefixSha256(hash: string): string {
  return `sha256:${hash}`;
}

function normalizeManifestActualUrl(route: string): string {
  return new URL(route, 'http://agentsmith.visual.local').pathname;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildVisualBaselineRunManifest(args: {
  runId: string;
  build: VisualBaselineBuildRecord;
  scenarios: readonly VisualBaselineScenarioRecord[];
}) {
  return {
    schema: 'visual_baseline_run_manifest/v1',
    run_id: args.runId,
    build: {
      lane: args.build.lane,
      run_id: args.build.runId,
      git_sha: args.build.gitSha,
      fingerprint: args.build.fingerprint,
      started_at: args.build.startedAt,
    },
    scenarios: args.scenarios.map((scenario) => {
      const evidence = buildVisualBaselineScenarioEvidence(scenario);
      return {
        scenario_id: scenario.scenarioId,
        actual_url: normalizeManifestActualUrl(scenario.route),
        story_fingerprint: evidence.storyFingerprint,
        screenshots: evidence.screenshots.map((entry) => ({
          file_name: entry.fileName,
          actual_sha256: prefixSha256(entry.screenshotSha256),
          baseline_sha256: prefixSha256(entry.baselineSha256),
        })),
      };
    }),
  };
}

const runId = process.env.MOCK_RUN_ID?.trim()
  || process.env.RELEASE_CAMPAIGN_RUN_ID?.trim()
  || timestampRunId();
const outputRoot = process.env.VISUAL_BASELINE_REVIEW_ROOT;
const build = readRequiredBuildRecord(process.env.VISUAL_BASELINE_BUILD_INFO_FILE);
const scenarios = groupVisualBaselineCatalogByScenario();
const orderedScenarios = [...scenarios.values()].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
const reviewRoot = resolveReviewRoot(outputRoot);
const runRoot = join(reviewRoot, runId);

mkdirSync(runRoot, { recursive: true });
writeJsonFile(join(runRoot, 'run-manifest.json'), buildVisualBaselineRunManifest({
  runId,
  build,
  scenarios: orderedScenarios,
}));

let written = 0;

for (const scenario of orderedScenarios) {
  const reviewDir = resolveVisualBaselineReviewDir({
    outputRoot,
    runId,
    scenarioId: scenario.scenarioId,
  });
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(
    join(reviewDir, 'automated-pass.md'),
    renderVisualBaselineAutomatedPassMarkdown({
      scenario,
      build,
      automated: {
        generatedAt: new Date().toISOString(),
        automatedVerdict: 'passed',
        semanticVerdict: 'passed',
        actualUrl: scenario.route,
        notes: [
          'Playwright visual lane completed for this scenario.',
          'This automated artifact is not a UX/UI release acceptance. A reviewer must write review.md with the UX acceptance contract before release.',
        ],
      },
    }),
  );
  written += 1;
}

process.stdout.write(`[visual-baseline-review] wrote ${written} automated visual pass artifacts for run ${runId}\n`);
