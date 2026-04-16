import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  buildVisualBaselineScenarioEvidence,
  type VisualBaselineReviewEvidenceSnapshot,
  groupVisualBaselineCatalogByScenario,
  readVisualBaselineBuildRecord,
  renderVisualBaselineAutomatedPassMarkdown,
  resolveVisualBaselineReviewDir,
  type VisualBaselineBuildRecord,
  type VisualBaselineCatalogEntry,
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

function resolveActualCaptureRoot(buildInfoPath: string | undefined): string {
  const explicitRoot = process.env.VISUAL_BASELINE_ACTUAL_CAPTURE_ROOT?.trim();
  if (explicitRoot) {
    return resolve(explicitRoot);
  }

  const normalizedBuildInfoPath = buildInfoPath?.trim();
  if (!normalizedBuildInfoPath) {
    throw new Error(
      'VISUAL_BASELINE_BUILD_INFO_FILE is required to resolve run-bound actual captures. '
        + 'Run the official visual lane so it can persist actual screenshots before writing review artifacts.',
    );
  }

  return resolve(dirname(normalizedBuildInfoPath), 'visual-actual-captures');
}

function prefixSha256(hash: string): string {
  return `sha256:${hash}`;
}

function normalizeManifestActualUrl(route: string): string {
  const parsed = new URL(route, 'http://agentsmith.visual.local');
  return `${parsed.pathname}${parsed.search}`;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function copyActualCaptureFile(args: {
  sourceRoot: string;
  runRoot: string;
  scenarioId: string;
  fileName: string;
}): { relPath: string; sha256: string } {
  const relativePath = join('captured', args.scenarioId, args.fileName);
  const sourcePath = resolve(args.sourceRoot, args.scenarioId, args.fileName);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `missing run-bound visual actual capture for ${args.scenarioId}/${args.fileName}: ${sourcePath}`,
    );
  }
  const targetPath = join(args.runRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return {
    relPath: relativePath.replaceAll('\\', '/'),
    sha256: sha256Hex(readFileSync(targetPath)),
  };
}

function resolveActualCaptureSourcePath(args: {
  sourceRoot: string;
  scenarioId: string;
  fileName: string;
}): string {
  return resolve(args.sourceRoot, args.scenarioId, args.fileName);
}

function collectRunBoundScenarioEntries(args: {
  actualCaptureRoot: string;
  scenarios: readonly VisualBaselineScenarioRecord[];
}): VisualBaselineScenarioRecord[] {
  const capturedScenarios = args.scenarios.flatMap((scenario) => {
    const capturedEntries = scenario.entries.filter((entry) => existsSync(resolveActualCaptureSourcePath({
      sourceRoot: args.actualCaptureRoot,
      scenarioId: scenario.scenarioId,
      fileName: entry.screenshot,
    })));
    if (capturedEntries.length === 0) {
      return [];
    }
    return [{
      ...scenario,
      entries: capturedEntries as VisualBaselineCatalogEntry[],
    }];
  });

  if (capturedScenarios.length === 0) {
    throw new Error(
      `no run-bound visual actual captures were found under ${args.actualCaptureRoot}. `
        + 'Run the visual executor first so this run emits actual screenshots before writing review artifacts.',
    );
  }

  return capturedScenarios;
}

function buildVisualBaselineRunManifest(args: {
  runId: string;
  build: VisualBaselineBuildRecord;
  actualCaptureRoot: string;
  runRoot: string;
  scenarios: readonly VisualBaselineScenarioRecord[];
}): {
  manifest: {
    schema: 'visual_baseline_run_manifest/v2';
    run_id: string;
    build: {
      lane: VisualBaselineBuildRecord['lane'];
      run_id: string;
      git_sha: string;
      fingerprint: string;
      started_at: string;
    };
    coverage: {
      scope: 'full_catalog' | 'partial_catalog';
      expected_scenario_ids: string[];
      captured_scenario_ids: string[];
    };
    scenarios: Array<{
      scenario_id: string;
      actual_url: string;
      story_fingerprint: string;
      screenshots: Array<{
        file_name: string;
        actual_relpath: string;
        actual_sha256: string;
        baseline_sha256: string;
      }>;
    }>;
  };
  evidenceByScenarioId: Map<string, VisualBaselineReviewEvidenceSnapshot>;
  capturedScenarios: readonly VisualBaselineScenarioRecord[];
} {
  const evidenceByScenarioId = new Map<string, VisualBaselineReviewEvidenceSnapshot>();
  const capturedScenarios = collectRunBoundScenarioEntries({
    actualCaptureRoot: args.actualCaptureRoot,
    scenarios: args.scenarios,
  });
  const expectedScenarioIds = args.scenarios
    .map((scenario) => scenario.scenarioId)
    .sort((left, right) => left.localeCompare(right));
  const capturedScenarioIds = capturedScenarios
    .map((scenario) => scenario.scenarioId)
    .sort((left, right) => left.localeCompare(right));
  const coverageScope = expectedScenarioIds.length === capturedScenarioIds.length
    && expectedScenarioIds.every((scenarioId, index) => scenarioId === capturedScenarioIds[index])
    ? 'full_catalog'
    : 'partial_catalog';

  const manifest = {
    schema: 'visual_baseline_run_manifest/v2' as const,
    run_id: args.runId,
    build: {
      lane: args.build.lane,
      run_id: args.build.runId,
      git_sha: args.build.gitSha,
      fingerprint: args.build.fingerprint,
      started_at: args.build.startedAt,
    },
    coverage: {
      scope: coverageScope,
      expected_scenario_ids: expectedScenarioIds,
      captured_scenario_ids: capturedScenarioIds,
    },
    scenarios: capturedScenarios.map((scenario) => {
      const evidence = buildVisualBaselineScenarioEvidence(scenario);
      const runBoundEvidence: VisualBaselineReviewEvidenceSnapshot = {
        storyFingerprint: evidence.storyFingerprint,
        screenshots: evidence.screenshots.map((entry) => {
          const capture = copyActualCaptureFile({
            sourceRoot: args.actualCaptureRoot,
            runRoot: args.runRoot,
            scenarioId: scenario.scenarioId,
            fileName: entry.fileName,
          });
          return {
            fileName: entry.fileName,
            actualSha256: prefixSha256(capture.sha256),
            baselineSha256: prefixSha256(entry.baselineSha256),
          };
        }),
      };
      evidenceByScenarioId.set(scenario.scenarioId, runBoundEvidence);

      return {
        scenario_id: scenario.scenarioId,
        actual_url: normalizeManifestActualUrl(scenario.route),
        story_fingerprint: runBoundEvidence.storyFingerprint,
        screenshots: runBoundEvidence.screenshots.map((entry) => ({
          file_name: entry.fileName,
          actual_relpath: join('captured', scenario.scenarioId, entry.fileName).replaceAll('\\', '/'),
          actual_sha256: entry.actualSha256,
          baseline_sha256: entry.baselineSha256,
        })),
      };
    }),
  };

  return {
    manifest,
    evidenceByScenarioId,
    capturedScenarios,
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
const actualCaptureRoot = resolveActualCaptureRoot(process.env.VISUAL_BASELINE_BUILD_INFO_FILE);
const runArtifacts = buildVisualBaselineRunManifest({
  runId,
  build,
  actualCaptureRoot,
  runRoot,
  scenarios: orderedScenarios,
});

mkdirSync(runRoot, { recursive: true });
writeJsonFile(join(runRoot, 'run-manifest.json'), runArtifacts.manifest);

let written = 0;

for (const scenario of runArtifacts.capturedScenarios) {
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
      evidenceSnapshot: runArtifacts.evidenceByScenarioId.get(scenario.scenarioId),
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
