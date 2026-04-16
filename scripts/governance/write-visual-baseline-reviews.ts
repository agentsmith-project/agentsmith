import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  groupVisualBaselineCatalogByScenario,
  readVisualBaselineBuildRecord,
  renderVisualBaselineAutomatedPassMarkdown,
  resolveVisualBaselineReviewDir,
  type VisualBaselineBuildRecord,
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

const runId = process.env.MOCK_RUN_ID?.trim()
  || process.env.RELEASE_CAMPAIGN_RUN_ID?.trim()
  || timestampRunId();
const outputRoot = process.env.VISUAL_BASELINE_REVIEW_ROOT;
const build = readRequiredBuildRecord(process.env.VISUAL_BASELINE_BUILD_INFO_FILE);
const scenarios = groupVisualBaselineCatalogByScenario();
let written = 0;

for (const scenario of [...scenarios.values()].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))) {
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
