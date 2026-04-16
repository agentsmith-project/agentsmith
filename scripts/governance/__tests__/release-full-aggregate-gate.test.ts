import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignEvidenceCheck,
  type CurrentVerificationCampaignStep,
} from '../current-verification-campaign-manifest';
import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  evidencePointerPath,
  materializeCampaignPath,
  nativeResultPath,
  resolveCampaignRunId,
  stepDir,
  writeCampaignEvidencePointer,
  writeCampaignGateResult,
} from '../release-campaign-io';
import {
  buildStorySourceFingerprint,
  buildStoryStepMapFingerprint,
  buildStoryFingerprint,
  resolveStoryTraceOrderContract,
  type StoryDefinition,
  type StoryStepDefinition,
  type StoryTargetMatch,
} from '../../../e2e/story-contract';
import { getReleaseStoryDefinition } from '../../../e2e/release-user-story.contract';
import { buildTraceStoryBinding } from '../../../e2e/story-trace-binding';
import {
  resolveUxTraceBundleDir,
  type UxTraceBundleManifest,
} from '../../../e2e/trace-bundle-support';
import {
  buildVisualBaselineScenarioEvidence,
  groupVisualBaselineCatalogByScenario,
  renderVisualBaselineAutomatedPassMarkdown,
  renderVisualBaselineScenarioReviewMarkdown,
  type VisualBaselineReviewRecord,
  type VisualBaselineReviewEvidenceSnapshot,
  type VisualBaselineScenarioRecord,
} from '../../../e2e/visual-baseline-support';

type RunAggregateOptions = {
  env?: NodeJS.ProcessEnv;
};

type AggregateFixtureEvidenceKind =
  | 'file'
  | 'directory'
  | 'directory_non_empty'
  | 'recursive_file'
  | 'visual_baseline_reviews'
  | 'visual_run_manifest';

const UPSTREAM_STEP_IDS = [
  'gate-fast',
  'gate-default',
  'lane-visual',
  'gate-release',
  'lane-demo-rehearsal',
  'lane-cluster-rehearsal',
] as const;

function getReleaseFullCampaign() {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign.');
  }
  return campaign;
}

function getCampaignStep(stepId: string): CurrentVerificationCampaignStep {
  const step = getReleaseFullCampaign().steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Missing step: ${stepId}`);
  }
  return step;
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function npmScriptForNativeResult(step: CurrentVerificationCampaignStep): string {
  return step.id === 'gate-release' ? 'lane:backend-real:release' : step.npmScript;
}

function writeNativeResult(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  overrides: Partial<{
    schema_version: string;
    gate_id: string;
    npm_script: string;
    status: string;
    failure_class: string;
    line_kind: string;
    evidence_dir: string;
  }> = {},
): void {
  const path = nativeResultPath(campaignRoot, step);
  if (!step.nativeResult || !path) {
    return;
  }

  writeJson(path, {
    schema_version: overrides.schema_version ?? CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: overrides.gate_id ?? step.nativeResult.gateId,
    gate_adapter: {
      npm_script: overrides.npm_script ?? npmScriptForNativeResult(step),
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: 'complete',
    line_kind: overrides.line_kind ?? step.lineKind,
    evidence_dir: overrides.evidence_dir ?? dirname(path),
    summary: `${step.id} native result passed in aggregate test.`,
    generated_at: new Date().toISOString(),
  });
}

function createFile(path: string, content: string | Buffer = 'aggregate evidence fixture\n'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function aggregateFixtureEvidenceKind(check: CurrentVerificationCampaignEvidenceCheck): AggregateFixtureEvidenceKind {
  return (check as { kind: AggregateFixtureEvidenceKind }).kind;
}

function getVisualRunManifestPath(campaignRoot: string): string {
  return resolve(
    campaignRoot,
    'lane-visual',
    'visual-baseline-reviews',
    resolveCampaignRunId(campaignRoot),
    'run-manifest.json',
  );
}

function getVisualReviewCheck(): CurrentVerificationCampaignEvidenceCheck {
  const visualStep = getCampaignStep('lane-visual');
  const visualReviewCheck = visualStep.evidenceChecks.find(
    (check) => aggregateFixtureEvidenceKind(check) === 'visual_baseline_reviews',
  );
  if (!visualReviewCheck) {
    throw new Error('Missing visual review evidence check.');
  }
  return visualReviewCheck;
}

function getVisualRunManifestCheck(): CurrentVerificationCampaignEvidenceCheck {
  const visualStep = getCampaignStep('lane-visual');
  const visualRunManifestCheck = visualStep.evidenceChecks.find(
    (check) => aggregateFixtureEvidenceKind(check) === 'visual_run_manifest',
  );
  if (!visualRunManifestCheck) {
    throw new Error('Missing visual run manifest evidence check.');
  }
  return visualRunManifestCheck;
}

function createManifestEvidenceForCheck(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): void {
  if (check.semantic === 'ux_trace_bundle') {
    writeSemanticUxTraceBundle(campaignRoot);
    return;
  }

  const kind = aggregateFixtureEvidenceKind(check);

  if (kind === 'visual_run_manifest') {
    writeVisualRunManifestFixture(campaignRoot);
    return;
  }

  if (kind === 'visual_baseline_reviews') {
    for (const scenario of groupVisualBaselineCatalogByScenario().values()) {
      createFile(
        materializeCampaignPath(
          campaignRoot,
          check.path.replaceAll('<visual-scenario-id>', scenario.scenarioId),
        ),
        renderVisualReviewFixture(campaignRoot, scenario),
      );
    }
    return;
  }

  const path = materializeCampaignPath(campaignRoot, check.path);
  if (kind === 'file') {
    if (!existsSync(path)) {
      createFile(path);
    }
    return;
  }

  if (kind === 'directory') {
    createDirectory(path);
    return;
  }

  if (kind === 'directory_non_empty') {
    createDirectory(path);
    if (path.startsWith(`${campaignRoot}/`)) {
      createFile(join(path, '.aggregate-fixture'));
    }
    return;
  }

  if (kind === 'recursive_file') {
    createFile(
      join(path, 'aggregate-fixture', check.fileName === '.md' ? 'report.md' : (check.fileName ?? 'review.md')),
    );
    return;
  }

  throw new Error(
    `Unhandled aggregate fixture evidence kind: ${String(kind)} for ${check.id} (${check.path})`,
  );
}

function createManifestEvidence(campaignRoot: string, step: CurrentVerificationCampaignStep): void {
  for (const check of step.evidenceChecks) {
    createManifestEvidenceForCheck(campaignRoot, check);
  }
}

function defaultVisualActualCaptureContent(
  scenarioId: string,
  fileName: string,
): Buffer {
  return Buffer.from(`aggregate-run actual capture ${scenarioId}/${fileName}`);
}

function buildVisualReviewEvidenceSnapshot(
  scenario: VisualBaselineScenarioRecord,
  scenarioOverride?: Partial<{
    story_fingerprint: string;
    screenshots: Array<{
      file_name: string;
      actual_relpath?: string;
      actual_sha256: string;
      baseline_sha256: string;
      content?: string | Buffer;
    }>;
  }>,
): VisualBaselineReviewEvidenceSnapshot {
  const evidence = buildVisualBaselineScenarioEvidence(scenario);
  const screenshotOverrides = new Map(
    (scenarioOverride?.screenshots ?? [])
      .filter((entry) => typeof entry.file_name === 'string')
      .map((entry) => [entry.file_name, entry] as const),
  );

  return {
    storyFingerprint: scenarioOverride?.story_fingerprint ?? evidence.storyFingerprint,
    screenshots: evidence.screenshots.map((entry) => {
      const override = screenshotOverrides.get(entry.fileName);
      const actualCaptureContent = override?.content ?? defaultVisualActualCaptureContent(scenario.scenarioId, entry.fileName);
      return {
        fileName: entry.fileName,
        actualSha256: override?.actual_sha256
          ?? `sha256:${createHash('sha256').update(actualCaptureContent).digest('hex')}`,
        baselineSha256: override?.baseline_sha256 ?? `sha256:${entry.baselineSha256}`,
      };
    }),
  };
}

function renderVisualReviewFixture(
  campaignRoot: string,
  scenario: VisualBaselineScenarioRecord,
  reviewOverrides: Partial<VisualBaselineReviewRecord> = {},
  options: {
    includeBuild?: boolean;
    evidenceSnapshot?: VisualBaselineReviewEvidenceSnapshot;
  } = {},
): string {
  const includeBuild = options.includeBuild ?? true;
  return renderVisualBaselineScenarioReviewMarkdown({
    scenario,
    build: includeBuild
      ? {
          lane: 'mock-lane',
          runId: resolveCampaignRunId(campaignRoot),
          gitSha: 'aggregate-test-git-sha',
          fingerprint: `${resolveCampaignRunId(campaignRoot)}:mock-lane:visual`,
          startedAt: '2026-04-12T11:59:00.000Z',
        }
      : undefined,
    review: {
      reviewerId: 'aggregate-test',
      reviewerKind: 'ai_reviewer',
      reviewMode: 'ai_native_screenshot_review',
      reviewedAt: '2026-04-12T12:00:00.000Z',
      verdict: 'accepted',
      actualUrl: scenario.route,
      findings: ['Aggregate test visual review fixture.'],
      ...reviewOverrides,
    },
    evidenceSnapshot: options.evidenceSnapshot ?? buildVisualReviewEvidenceSnapshot(scenario),
  });
}

function writeVisualRunManifestFixture(
  campaignRoot: string,
  overrides: Partial<{
    run_id: string;
    build: Partial<{
      lane: string;
      run_id: string;
      git_sha: string;
      fingerprint: string;
      started_at: string;
    }>;
    scenarioOverrides: Record<
      string,
      Partial<{
        actual_url: string;
        story_fingerprint: string;
        screenshots: Array<{
          file_name: string;
          actual_relpath?: string;
          actual_sha256: string;
          baseline_sha256: string;
          content?: string | Buffer;
        }>;
      }>
    >;
  }> = {},
): void {
  const runId = overrides.run_id ?? resolveCampaignRunId(campaignRoot);
  const scenarios = [...groupVisualBaselineCatalogByScenario().values()]
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
    .map((scenario) => {
      const evidence = buildVisualBaselineScenarioEvidence(scenario);
      const scenarioOverride = overrides.scenarioOverrides?.[scenario.scenarioId];
      return {
        scenario_id: scenario.scenarioId,
        actual_url: scenarioOverride?.actual_url ?? scenario.route,
        story_fingerprint: scenarioOverride?.story_fingerprint ?? evidence.storyFingerprint,
        screenshots: scenarioOverride?.screenshots
          ?? evidence.screenshots.map((entry) => ({
            file_name: entry.fileName,
            actual_relpath: `captured/${scenario.scenarioId}/${entry.fileName}`,
            actual_sha256: `sha256:${entry.screenshotSha256}`,
            baseline_sha256: `sha256:${entry.baselineSha256}`,
          })),
      };
    });

  for (const scenario of scenarios) {
    for (const screenshot of scenario.screenshots) {
      const fileName = typeof screenshot.file_name === 'string' ? screenshot.file_name : null;
      const actualRelPath = typeof screenshot.actual_relpath === 'string' ? screenshot.actual_relpath : null;
      if (!fileName || !actualRelPath) {
        continue;
      }
      const actualCaptureContent = 'content' in screenshot && screenshot.content !== undefined
        ? screenshot.content
        : defaultVisualActualCaptureContent(scenario.scenario_id, fileName);
      createFile(join(dirname(getVisualRunManifestPath(campaignRoot)), actualRelPath), actualCaptureContent);
      screenshot.actual_sha256 = `sha256:${createHash('sha256').update(actualCaptureContent).digest('hex')}`;
    }
  }

  writeJson(
    getVisualRunManifestPath(campaignRoot),
    {
      schema: 'visual_baseline_run_manifest/v2',
      run_id: runId,
      build: {
        lane: overrides.build?.lane ?? 'mock-lane',
        run_id: overrides.build?.run_id ?? runId,
        git_sha: overrides.build?.git_sha ?? 'aggregate-test-git-sha',
        fingerprint: overrides.build?.fingerprint ?? `${runId}:mock-lane:visual`,
        started_at: overrides.build?.started_at ?? '2026-04-12T11:59:00.000Z',
      },
      scenarios,
    },
  );
}

function overwriteVisualReviewFixture(
  campaignRoot: string,
  scenarioId: string,
  content: string,
): void {
  const visualReviewCheck = getVisualReviewCheck();
  createFile(
    materializeCampaignPath(
      campaignRoot,
      visualReviewCheck.path.replaceAll('<visual-scenario-id>', scenarioId),
    ),
    content,
  );
}

function getVisualScenario(scenarioId: string): VisualBaselineScenarioRecord {
  const scenario = groupVisualBaselineCatalogByScenario().get(scenarioId);
  if (!scenario) {
    throw new Error(`Missing visual scenario: ${scenarioId}`);
  }
  return scenario;
}

type UxTraceReviewVerdict = 'accepted' | 'needs_work' | 'blocked';

type SemanticUxTraceFixtureOptions = Partial<{
  storyFingerprint: string;
  stepMapFingerprint: string;
  omitRequiredStep: string;
  omitRequiredScreenshotStep: string;
  reviewVerdict: UxTraceReviewVerdict;
}>;

function stepTargetMatches(expected: string, actual: string, mode: StoryTargetMatch = 'exact'): boolean {
  return mode === 'prefix' ? actual.startsWith(expected) : actual === expected;
}

function requiredTraceSteps(story: StoryDefinition): readonly StoryStepDefinition[] {
  return story.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
}

function stepRoute(story: StoryDefinition, step: StoryStepDefinition): string {
  const scene = story.scenes.find((candidate) => candidate.sceneId === step.sceneId);
  return scene?.route ?? story.entryRoute;
}

function getGateReleaseUxTraceRoot(campaignRoot: string): string {
  const gateRelease = getCampaignStep('gate-release');
  const traceCheck = gateRelease.evidenceChecks.find((check) => check.id === 'backend_real_ux_trace_reviews');
  if (!traceCheck) {
    throw new Error('Missing backend-real UX trace evidence check.');
  }
  return materializeCampaignPath(campaignRoot, traceCheck.path);
}

function renderUxTraceReviewFixture(args: {
  manifest: UxTraceBundleManifest;
  verdict: UxTraceReviewVerdict;
}): string {
  return [
    `# ${args.manifest.title}`,
    '',
    '- schema: ux_trace_bundle_review/v1',
    `- story_id: ${args.manifest.story_id}`,
    `- scenario_id: ${args.manifest.scenario_id}`,
    `- story_fingerprint: ${args.manifest.story_fingerprint}`,
    `- step_map_fingerprint: ${args.manifest.step_map_fingerprint}`,
    `- run_id: ${args.manifest.run_id}`,
    `- outcome: ${args.manifest.outcome}`,
    `- verdict: ${args.verdict}`,
    `- findings: ${args.verdict === 'accepted' ? 'No blocking findings.' : 'Trace review found release-blocking UX evidence.'}`,
    '',
    '## Trace Events',
    '',
    '- manifest.json',
    '- events.jsonl',
    '- screenshots/',
    '',
  ].join('\n');
}

function writeSemanticUxTraceBundle(
  campaignRoot: string,
  options: SemanticUxTraceFixtureOptions = {},
): void {
  const story = getReleaseStoryDefinition();
  const binding = buildTraceStoryBinding(story);
  const traceRoot = getGateReleaseUxTraceRoot(campaignRoot);
  const runId = 'release-trace-run';
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot: traceRoot,
    lane: 'backend-real',
    suite: 'integration-release-user-story',
    storyId: story.storyId,
    runId,
  });
  const requiredSteps = requiredTraceSteps(story);
  const requiredStepIds = requiredSteps.map((step) => step.stepId);
  const requiredScreenshotStepIds = requiredSteps
    .filter((step) => step.sceneId)
    .map((step) => step.stepId);
  const sourceFile = story.sourceFile ?? story.filePath;
  const storyFingerprint = options.storyFingerprint ?? buildStoryFingerprint(story);
  const stepMapFingerprint = options.stepMapFingerprint ?? buildStoryStepMapFingerprint(story);
  const events = requiredSteps
    .filter((step) => step.stepId !== options.omitRequiredStep)
    .map((step, index) => {
      const seq = index + 1;
      const screenshot = step.stepId === options.omitRequiredScreenshotStep
        ? undefined
        : `screenshots/${String(seq).padStart(3, '0')}-${step.stepId}.png`;
      if (screenshot) {
        createFile(join(bundleDir, screenshot), `screenshot for ${step.stepId}\n`);
      }
      return {
        seq,
        ts: '2026-04-12T12:00:00.000Z',
        step_id: step.stepId,
        action: step.action,
        target: step.target,
        route: stepRoute(story, step),
        assertion: step.expectedFeedback,
        note: step.note ?? step.expectedFeedback,
        screenshot,
      };
    });
  const manifest: UxTraceBundleManifest = {
    version: 1,
    story_id: story.storyId,
    story_source: binding.storySource,
    story_source_fingerprint: buildStorySourceFingerprint(readFileSync(resolve(sourceFile), 'utf8')),
    story_fingerprint: storyFingerprint,
    step_map_fingerprint: stepMapFingerprint,
    scenario_id: 'integration-release-user-story',
    title: story.title,
    actor: story.actor,
    lane: 'backend-real',
    suite: 'integration-release-user-story',
    route: story.entryRoute,
    spec_file: 'e2e/integration-release-user-story.spec.ts',
    browser: 'chromium',
    run_id: runId,
    git_sha: 'aggregate-test-git-sha',
    goal: story.goal,
    preconditions: story.preconditions ?? [],
    seed_data: story.seedData ?? [],
    required_trace_steps: requiredStepIds,
    required_screenshot_steps: requiredScreenshotStepIds,
    trace_order_contract: resolveStoryTraceOrderContract(story),
    started_at: '2026-04-12T11:59:00.000Z',
    finished_at: '2026-04-12T12:00:00.000Z',
    outcome: 'pass',
    event_count: events.length,
    screenshot_count: events.filter((event) => Boolean(event.screenshot)).length,
    screenshots: events
      .filter((event): event is typeof event & { screenshot: string } => Boolean(event.screenshot))
      .map((event) => ({
        seq: event.seq,
        step_id: event.step_id,
        file: event.screenshot,
        route: event.route,
        note: event.note,
      })),
  };

  writeJson(join(bundleDir, 'manifest.json'), manifest);
  writeJson(join(bundleDir, 'contract-snapshot.json'), {
    version: 1,
    lane: manifest.lane,
    suite: manifest.suite,
    story_id: manifest.story_id,
    scenario_id: manifest.scenario_id,
    run_id: manifest.run_id,
    story_source_fingerprint: manifest.story_source_fingerprint,
    story_fingerprint: manifest.story_fingerprint,
    step_map_fingerprint: manifest.step_map_fingerprint,
    required_trace_steps: manifest.required_trace_steps,
    required_screenshot_steps: manifest.required_screenshot_steps,
    trace_order_contract: manifest.trace_order_contract,
    steps: requiredSteps.map((step) => ({
      step_id: step.stepId,
      action: step.action,
      target: step.target,
      target_match: step.targetMatch ?? 'exact',
      scene_id: step.sceneId ?? null,
    })),
  });
  createFile(join(bundleDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  createFile(join(bundleDir, 'review.md'), renderUxTraceReviewFixture({
    manifest,
    verdict: options.reviewVerdict ?? 'accepted',
  }));
  writeJson(join(traceRoot, 'ux-trace-index.json'), {
    version: 1,
    generated_at: '2026-04-12T12:00:01.000Z',
    bundles: [{
      lane: manifest.lane,
      suite: manifest.suite,
      story_id: manifest.story_id,
      scenario_id: manifest.scenario_id,
      run_id: manifest.run_id,
      bundle_relpath: 'backend-real/integration-release-user-story/release-user-story-end-to-end/release-trace-run',
      review_relpath: 'backend-real/integration-release-user-story/release-user-story-end-to-end/release-trace-run/review.md',
      manifest_relpath: 'backend-real/integration-release-user-story/release-user-story-end-to-end/release-trace-run/manifest.json',
      contract_snapshot_relpath: 'backend-real/integration-release-user-story/release-user-story-end-to-end/release-trace-run/contract-snapshot.json',
    }],
  });

  for (const step of requiredSteps) {
    const event = events.find((candidate) => candidate.step_id === step.stepId);
    if (!event || !step.target || !event.target) {
      continue;
    }
    if (!stepTargetMatches(step.target, event.target, step.targetMatch ?? 'exact')) {
      throw new Error(`invalid trace fixture target for ${step.stepId}`);
    }
  }
}

function replaceGateReleaseUxTraceWithLegacyReviewOnly(campaignRoot: string): void {
  const traceRoot = getGateReleaseUxTraceRoot(campaignRoot);
  rmSync(traceRoot, { recursive: true, force: true });
  createFile(join(traceRoot, 'legacy', 'review.md'), '# Legacy backend-real UX trace review\n');
}

function replaceGateReleaseUxTraceWithSemanticBundle(
  campaignRoot: string,
  options: SemanticUxTraceFixtureOptions = {},
): void {
  const traceRoot = getGateReleaseUxTraceRoot(campaignRoot);
  rmSync(traceRoot, { recursive: true, force: true });
  writeSemanticUxTraceBundle(campaignRoot, options);
}

function writeLegacyDummyEvidencePointer(campaignRoot: string, step: CurrentVerificationCampaignStep): void {
  const evidenceDir = join(campaignRoot, '__legacy_dummy__', step.id);
  mkdirSync(evidenceDir, { recursive: true });
  const path = nativeResultPath(campaignRoot, step);
  writeJson(
    evidencePointerPath(campaignRoot, step),
    {
      schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
      step_id: step.id,
      gate_id: step.gateId,
      evidence_topology: 'campaign_root',
      campaign_root: resolve(campaignRoot),
      evidence_dir: stepDir(campaignRoot, step),
      native_result: step.nativeResult && path
        ? {
            path,
            exists: true,
            gate_id: step.nativeResult.gateId,
            status: 'passed',
            failure_class: 'none',
          }
        : null,
      required_paths: [{ id: 'legacy_hint', path: evidenceDir, kind: 'path', exists: true }],
      generated_at: new Date().toISOString(),
    },
  );
}

function seedPassedUpstreamStep(
  campaignRoot: string,
  stepId: string,
  options: Partial<{
    createRequiredEvidence: boolean;
    writeCurrentEvidencePointer: boolean;
  }> = {},
): void {
  const step = getCampaignStep(stepId);
  const createRequiredEvidence = options.createRequiredEvidence ?? true;
  const writeCurrentEvidencePointer = options.writeCurrentEvidencePointer ?? true;

  writeCampaignGateResult({
    step,
    campaignRoot,
    status: 'passed',
    failureClass: 'none',
    stage: 'complete',
    summary: `${stepId} passed in aggregate test.`,
  });

  if (step.evidenceRequired) {
    if (step.nativeResult) {
      writeNativeResult(campaignRoot, step);
    }
    if (createRequiredEvidence) {
      createManifestEvidence(campaignRoot, step);
    }
    if (writeCurrentEvidencePointer) {
      writeCampaignEvidencePointer(campaignRoot, step);
    } else {
      writeLegacyDummyEvidencePointer(campaignRoot, step);
    }
  }
}

function seedPassedCampaign(campaignRoot: string): void {
  for (const stepId of UPSTREAM_STEP_IDS) {
    seedPassedUpstreamStep(campaignRoot, stepId);
  }
}

function runAggregate(campaignRoot: string, options: RunAggregateOptions = {}): void {
  execFileSync('npx', ['tsx', 'scripts/governance/run-release-full-aggregate.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELEASE_CAMPAIGN_ROOT: campaignRoot,
      ...options.env,
    },
    stdio: 'pipe',
  });
}

function runAggregateWithoutExplicitCampaign(options: RunAggregateOptions = {}): void {
  const {
    RELEASE_CAMPAIGN_ROOT: _root,
    RELEASE_CAMPAIGN_RUN_ID: _runId,
    RELEASE_CAMPAIGN_USE_LATEST: _useLatest,
    ...baseEnv
  } = process.env;
  execFileSync('npx', ['tsx', 'scripts/governance/run-release-full-aggregate.ts'], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      ...options.env,
    },
    stdio: 'pipe',
  });
}

describe('release-full aggregate gate', () => {
  it('records campaign-root evidence topology on generated evidence pointers', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-evidence-topology-'));
    const visualStep = getCampaignStep('lane-visual');
    writeNativeResult(campaignRoot, visualStep);
    createManifestEvidence(campaignRoot, visualStep);

    writeCampaignEvidencePointer(campaignRoot, visualStep);

    const evidence = JSON.parse(
      readFileSync(evidencePointerPath(campaignRoot, visualStep), 'utf8'),
    ) as {
      evidence_topology?: string;
      campaign_root?: string;
      required_paths: readonly { path: string }[];
    };

    expect(evidence.evidence_topology).toBe('campaign_root');
    expect(evidence.campaign_root).toBe(resolve(campaignRoot));
    expect(evidence.required_paths.some((record) => record.path.includes(campaignRoot))).toBe(true);
  });

  it('keeps lane-visual authority manifest generation separate from review artifact generation', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-visual-fixture-ownership-'));
    const visualReviewCheck = getVisualReviewCheck();
    const visualRunManifestCheck = getVisualRunManifestCheck();
    const manifestPath = getVisualRunManifestPath(campaignRoot);

    createManifestEvidenceForCheck(campaignRoot, visualReviewCheck);

    expect(existsSync(manifestPath)).toBe(false);
    expect(
      existsSync(
        materializeCampaignPath(
          campaignRoot,
          visualReviewCheck.path.replaceAll('<visual-scenario-id>', 'desktop-auth-complete'),
        ),
      ),
    ).toBe(true);

    createManifestEvidenceForCheck(campaignRoot, visualRunManifestCheck);

    expect(statSync(manifestPath).isFile()).toBe(true);
    expect(statSync(dirname(manifestPath)).isDirectory()).toBe(true);
  });

  it('fails fast in aggregate test fixtures when a new evidence kind is unhandled', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-unhandled-evidence-kind-'));

    expect(() => createManifestEvidenceForCheck(
      campaignRoot,
      {
        id: 'future_contract_kind',
        path: '<campaign-root>/future/contract-kind',
        kind: 'future_contract_kind',
      } as unknown as CurrentVerificationCampaignEvidenceCheck,
    )).toThrow('Unhandled aggregate fixture evidence kind');
  });

  it('passes when every required campaign step result and current manifest evidence check is present', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-pass-'));
    seedPassedCampaign(campaignRoot);

    runAggregate(campaignRoot);

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; gate_id: string };
    expect(terminalResult).toMatchObject({
      gate_id: 'gate-release-full',
      status: 'passed',
      failure_class: 'none',
    });
    const terminalEvidence = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'evidence.json'), 'utf8'),
    ) as {
      required_paths: Array<Record<string, unknown>>;
    };
    expect(terminalEvidence.required_paths.length).toBeGreaterThan(0);
    for (const record of terminalEvidence.required_paths) {
      expect(record).toMatchObject({
        id: expect.any(String),
        path: expect.any(String),
        kind: expect.any(String),
        exists: expect.any(Boolean),
      });
    }
  });

  it('passes when backend-real UX trace bundles include semantic manifest, events, screenshots, and review evidence', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-semantic-pass-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot);
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

    runAggregate(campaignRoot);

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string };
    expect(terminalResult).toMatchObject({
      status: 'passed',
      failure_class: 'none',
    });
  });

  it('fails when backend-real UX trace evidence is only a legacy review.md without manifest and events', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-legacy-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithLegacyReviewOnly(campaignRoot);
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('ux-trace-index.json');
  });

  it('fails with contract drift when backend-real UX trace manifest drifts away from its producer-owned snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-fingerprint-drift-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot);
    const bundleDir = resolveUxTraceBundleDir({
      outputRoot: getGateReleaseUxTraceRoot(campaignRoot),
      lane: 'backend-real',
      suite: 'integration-release-user-story',
      storyId: getReleaseStoryDefinition().storyId,
      runId: 'release-trace-run',
    });
    const manifestPath = join(bundleDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.story_fingerprint = `sha256:${'1'.repeat(64)}`;
    manifest.step_map_fingerprint = `sha256:${'2'.repeat(64)}`;
    writeJson(manifestPath, manifest);
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('story_fingerprint drift');
    expect(terminalResult.summary).toContain('step_map_fingerprint drift');
  });

  it('fails when backend-real UX trace evidence misses a required story step or screenshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-missing-step-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot, {
      omitRequiredStep: 'workspace-login',
      omitRequiredScreenshotStep: 'project-overview',
    });
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('workspace-login');
    expect(terminalResult.summary).toContain('project-overview');
  });

  it.each(['needs_work', 'blocked'] as const)(
    'fails with product regression when backend-real UX trace review verdict is %s',
    (reviewVerdict) => {
      const campaignRoot = mkdtempSync(join(tmpdir(), `release-full-aggregate-trace-${reviewVerdict}-`));
      seedPassedCampaign(campaignRoot);
      replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot, { reviewVerdict });
      writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

      expect(() => runAggregate(campaignRoot)).toThrow();

      const terminalResult = JSON.parse(
        readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
      ) as { status: string; failure_class: string; summary: string };
      expect(terminalResult).toMatchObject({
        status: 'failed',
        failure_class: 'product_regression',
      });
      expect(terminalResult.summary).toContain('UX trace review verdict must be accepted');
    },
  );

  it('refuses to consume the latest release run unless the operator opts into diagnostic latest mode', () => {
    expect(() => runAggregateWithoutExplicitCampaign()).toThrow();
  });

  it('fails without rerunning upstream commands when required evidence is missing', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-fail-'));
    seedPassedCampaign(campaignRoot);
    const visualReviewRoot = resolve(campaignRoot, 'lane-visual', 'visual-baseline-reviews');
    rmSync(visualReviewRoot, { recursive: true, force: true });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; gate_id: string };
    expect(terminalResult).toMatchObject({
      gate_id: 'gate-release-full',
      status: 'failed',
      failure_class: 'evidence_missing',
    });
  });

  it('fails with contract drift when a visual review exists but omits current build metadata', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-metadata-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario, {}, { includeBuild: false }),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('visual UX acceptance metadata');
  });

  it('hard fails when lane-visual evidence keeps review markdown but loses run-manifest.json', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-manifest-missing-'));
    seedPassedCampaign(campaignRoot);
    rmSync(
      resolve(
        campaignRoot,
        'lane-visual',
        'visual-baseline-reviews',
        resolveCampaignRunId(campaignRoot),
        'run-manifest.json',
      ),
      { force: true },
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('run-manifest.json');
  });

  it('hard fails when lane-visual run-manifest.json is polluted', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-manifest-polluted-'));
    seedPassedCampaign(campaignRoot);
    writeFileSync(
      resolve(
        campaignRoot,
        'lane-visual',
        'visual-baseline-reviews',
        resolveCampaignRunId(campaignRoot),
        'run-manifest.json',
      ),
      '{ polluted',
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('run-manifest.json');
  });

  it('hard fails when lane-visual run-manifest.json binds the visual evidence to a different build run', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-manifest-foreign-run-'));
    seedPassedCampaign(campaignRoot);
    writeVisualRunManifestFixture(campaignRoot, {
      run_id: 'run-foreign-20260412-999',
      build: {
        run_id: 'run-foreign-20260412-999',
        fingerprint: 'run-foreign-20260412-999:mock-lane:visual',
      },
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('run-manifest.json');
  });

  it('hard fails when lane-visual run-manifest.json drops the query-bearing actual_url', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-manifest-query-drift-'));
    seedPassedCampaign(campaignRoot);
    writeVisualRunManifestFixture(campaignRoot, {
      scenarioOverrides: {
        'desktop-auth-complete': {
          actual_url: '/en-US/desktop/auth/complete',
        },
      },
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('actual_url drift');
  });

  it('fails when backend-real UX trace evidence loses ux-trace-index.json even if review markdown still exists', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-missing-index-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot);
    rmSync(join(getGateReleaseUxTraceRoot(campaignRoot), 'ux-trace-index.json'), { force: true });
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('gate-release'));

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('ux-trace-index.json');
  });

  it('fails when an automated visual pass artifact is copied into the UX acceptance slot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-automated-pass-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualBaselineAutomatedPassMarkdown({
        scenario,
        build: {
          lane: 'mock-lane',
          runId: resolveCampaignRunId(campaignRoot),
          gitSha: 'aggregate-test-git-sha',
          fingerprint: `${resolveCampaignRunId(campaignRoot)}:mock-lane:visual`,
          startedAt: '2026-04-12T11:59:00.000Z',
        },
        automated: {
          generatedAt: '2026-04-12T12:00:00.000Z',
          automatedVerdict: 'passed',
          semanticVerdict: 'passed',
          actualUrl: scenario.route,
          notes: ['Playwright visual lane completed for this scenario.'],
        },
      }),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('Automated visual pass cannot be used as UX acceptance');
  });

  it('fails with contract drift when a visual UX acceptance omits reviewer proof', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-reviewer-proof-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario).replace('- reviewer_id: aggregate-test\n', ''),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('reviewer_id');
  });

  it('fails with contract drift when visual UX acceptance omits actual URL or story fingerprint', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-story-proof-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario)
        .replace('- actual_url: /en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001\n', '')
        .replace(/- story_fingerprint: .+\n/, ''),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('actual_url');
    expect(terminalResult.summary).toContain('story_fingerprint');
  });

  it('passes when visual UX acceptance stays self-consistent with the producer snapshot even if checkout story fingerprints drift', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-snapshot-owned-pass-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    const evidence = buildVisualBaselineScenarioEvidence(scenario);
    const customStoryFingerprint = `sha256:${'4'.repeat(64)}`;
    const screenshotFixtures = evidence.screenshots.map((entry, index) => ({
      file_name: entry.fileName,
      actual_relpath: `captured/${scenario.scenarioId}/${entry.fileName}`,
      actual_sha256: '',
      baseline_sha256: `sha256:${entry.baselineSha256}`,
      content: Buffer.from(`snapshot-owned actual ${scenario.scenarioId}/${entry.fileName}/${index}`),
    }));
    writeVisualRunManifestFixture(campaignRoot, {
      scenarioOverrides: {
        [scenario.scenarioId]: {
          story_fingerprint: customStoryFingerprint,
          screenshots: screenshotFixtures,
        },
      },
    });
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario, {}, {
        evidenceSnapshot: buildVisualReviewEvidenceSnapshot(scenario, {
          story_fingerprint: customStoryFingerprint,
          screenshots: screenshotFixtures,
        }),
      }),
    );

    runAggregate(campaignRoot);

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string };
    expect(terminalResult).toMatchObject({
      status: 'passed',
      failure_class: 'none',
    });
  });

  it('fails with contract drift when visual UX acceptance build metadata drifts from the run-manifest snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-build-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario)
        .replace('- build_git_sha: aggregate-test-git-sha\n', '- build_git_sha: foreign-git-sha\n'),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('build_git_sha');
  });

  it('fails with contract drift when visual UX acceptance hashes drift from committed baselines', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-hash-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    const evidence = buildVisualBaselineScenarioEvidence(scenario);
    const firstScreenshot = evidence.screenshots[0];
    if (!firstScreenshot) {
      throw new Error('Missing visual screenshot fixture.');
    }
    const baselineHashLine = `- accepted_baseline_hashes: ${evidence.screenshots
      .map((entry) => `${entry.fileName}=sha256:${entry.baselineSha256}`)
      .join('; ')}`;
    const driftedBaselineHashLine = baselineHashLine.replace(
      `${firstScreenshot.fileName}=sha256:${firstScreenshot.baselineSha256}`,
      `${firstScreenshot.fileName}=sha256:${'0'.repeat(64)}`,
    );
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario).replace(baselineHashLine, driftedBaselineHashLine),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('baseline hash drift');
  });

  it('fails with contract drift when visual UX acceptance story fingerprint drifts', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-story-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario).replace(/- story_fingerprint: .+\n/, `- story_fingerprint: sha256:${'1'.repeat(64)}\n`),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('story_fingerprint drift');
  });

  it('fails with product regression when a visual UX acceptance verdict is not accepted', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-verdict-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario, {
        verdict: 'needs_work',
      }),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'product_regression',
    });
    expect(terminalResult.summary).toContain('verdict must be accepted');
  });

  it('fails with product regression when a visual UX acceptance verdict is blocked', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-blocked-verdict-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario, {
        verdict: 'blocked',
      }),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'product_regression',
    });
    expect(terminalResult.summary).toContain('verdict must be accepted');
  });

  it('fails with product regression when a visual review contains blocking findings', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-blocker-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualReviewFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualReviewFixture(campaignRoot, scenario, {
        blockingFindings: ['The auth completion state lost its primary recovery action.'],
      }),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'product_regression',
    });
    expect(terminalResult.summary).toContain('blocking findings');
  });

  it('rejects legacy evidence pointers that omit current manifest evidence check ids', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-legacy-pointer-'));
    seedPassedCampaign(campaignRoot);
    const visualStep = getCampaignStep('lane-visual');
    writeLegacyDummyEvidencePointer(campaignRoot, visualStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('missing current evidence check id');
  });

  it('does not accept dummy required paths when manifest-required backend and rehearsal evidence is absent', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-dummy-pointer-'));
    for (const stepId of UPSTREAM_STEP_IDS) {
      seedPassedUpstreamStep(campaignRoot, stepId, {
        createRequiredEvidence: false,
        writeCurrentEvidencePointer: false,
      });
    }

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('missing current evidence check id');
  });

  it('does not allow a failed upstream step to produce a terminal none failure class', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-failed-step-'));
    seedPassedCampaign(campaignRoot);
    const gateDefault = getCampaignStep('gate-default');
    writeCampaignGateResult({
      step: gateDefault,
      campaignRoot,
      status: 'failed',
      failureClass: 'none',
      stage: 'execute',
      summary: 'invalid failed step fixture',
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; gate_id: string };
    expect(terminalResult).toMatchObject({
      gate_id: 'gate-release-full',
      status: 'failed',
      failure_class: 'product_regression',
    });
  });

  it('reports malformed evidence pointers as contract drift instead of crashing', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-contract-drift-'));
    seedPassedCampaign(campaignRoot);
    writeJson(
      resolve(campaignRoot, 'lane-visual', 'evidence.json'),
      {
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        step_id: 'lane-visual',
        gate_id: 'lane-visual',
        evidence_dir: resolve(campaignRoot, 'lane-visual'),
        native_result: {
          path: resolve(campaignRoot, 'lane-visual', 'native', 'result.json'),
          exists: true,
          gate_id: 'lane-visual',
          status: 'passed',
          failure_class: 'none',
        },
        required_paths: [{ exists: true }],
        generated_at: new Date().toISOString(),
      },
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; gate_id: string };
    expect(terminalResult).toMatchObject({
      gate_id: 'gate-release-full',
      status: 'failed',
      failure_class: 'contract_drift',
    });
  });

  it('fails with evidence_missing when an evidence owner wrapper result has no native result', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-missing-native-'));
    seedPassedCampaign(campaignRoot);
    const nativeResultPath = resolve(campaignRoot, 'lane-visual', 'native', 'result.json');
    writeFileSync(nativeResultPath, '');

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('Malformed native result');
  });

  it('fails with contract drift when a native result has the wrong traceability fields', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-native-traceability-'));
    seedPassedCampaign(campaignRoot);
    writeNativeResult(campaignRoot, getCampaignStep('lane-visual'), {
      line_kind: 'backend_real',
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('line_kind mismatch');
  });

  it('fails with contract drift when a campaign wrapper result has the wrong traceability fields', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-wrapper-traceability-'));
    seedPassedCampaign(campaignRoot);
    const visualStep = getCampaignStep('lane-visual');
    writeJson(resolve(campaignRoot, 'lane-visual', 'result.json'), {
      schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
      gate_id: visualStep.gateId,
      gate_adapter: { npm_script: 'test:visual', ci_job: null },
      status: 'passed',
      failure_class: 'none',
      stage: 'complete',
      line_kind: visualStep.lineKind,
      evidence_dir: stepDir(campaignRoot, visualStep),
      summary: 'wrong wrapper npm script',
      generated_at: new Date().toISOString(),
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('gate_adapter.npm_script mismatch');
  });

  it('fails with contract drift when an evidence pointer is not bound to the current step', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-pointer-traceability-'));
    seedPassedCampaign(campaignRoot);
    const visualEvidencePath = resolve(campaignRoot, 'lane-visual', 'evidence.json');
    const evidence = JSON.parse(readFileSync(visualEvidencePath, 'utf8')) as Record<string, unknown>;
    writeJson(visualEvidencePath, {
      ...evidence,
      step_id: 'gate-release',
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('step_id mismatch');
  });

  it('fails with contract drift when an evidence pointer is not bound to campaign-root topology', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-pointer-topology-'));
    seedPassedCampaign(campaignRoot);
    const visualEvidencePath = resolve(campaignRoot, 'lane-visual', 'evidence.json');
    const evidence = JSON.parse(readFileSync(visualEvidencePath, 'utf8')) as Record<string, unknown>;
    writeJson(visualEvidencePath, {
      ...evidence,
      evidence_topology: 'standalone',
      campaign_root: resolve('artifacts', 'visual-baseline-reviews'),
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('evidence_topology');
  });

  it('writes a terminal contract_drift result when a campaign step result is truncated JSON', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-truncated-json-'));
    seedPassedCampaign(campaignRoot);
    writeFileSync(resolve(campaignRoot, 'gate-default', 'result.json'), '{');

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('Malformed campaign step result');
  });
});
