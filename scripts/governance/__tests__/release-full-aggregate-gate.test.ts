import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY,
  type CurrentGateEvidenceArtifact,
} from '../current-gate-manifest';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignEvidenceCheck,
  type CurrentVerificationCampaignStep,
} from '../current-verification-campaign-manifest';
import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  assertSafeReleaseCampaignRunId,
  evidencePointerPath,
  evaluateCampaignEvidenceChecks,
  materializeCampaignPath,
  nativeResultPath,
  prepareReleaseCampaignRootForWrite,
  resolveExistingCampaignRoot,
  resolveCampaignRoot,
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
  | 'visual_baseline_automated_passes'
  | 'visual_baseline_reviews'
  | 'visual_run_manifest';

const UPSTREAM_STEP_IDS = [
  'gate-fast',
  'gate-default',
  'lane-visual',
  'gate-release',
  'lane-unified-deploy-substrate',
  'lane-unified-deploy-local-kind-images',
  'lane-unified-deploy-local-kind',
  'lane-unified-deploy-product-flows',
] as const;

const REQUIRED_RELEASE_PRODUCT_FLOWS = ['workspace_project', 'files', 'agent_task_managed_runner'] as const;

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

function writeUnifiedDeployEvidenceFixture(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): void {
  const root = materializeCampaignPath(campaignRoot, check.path);
  const generatedAt = '2026-05-07T00:00:00.000Z';

  if (check.id === 'unified_deploy_substrate_evidence') {
    writeJson(join(root, 'substrate-lifecycle-reset-fixture.json'), {
      schema_version: check.expectedSchemaVersion,
      command: check.expectedCommand,
      profile: check.expectedProfile,
      status: check.expectedStatus,
      generated_at: generatedAt,
      services: ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'],
      failures: [],
      paths: {
        report_path: join(root, 'substrate-lifecycle-reset-fixture.json'),
        log_path: join(root, 'substrate-lifecycle-reset-fixture.log'),
      },
    });
    return;
  }

  if (check.id === 'unified_deploy_local_kind_images_evidence') {
    writeJson(join(root, 'local-kind-images-fixture.json'), {
      schema_version: check.expectedSchemaVersion,
      producer: check.expectedProducer,
      status: check.expectedStatus,
      generated_at: generatedAt,
      generated_site_env_path: join(campaignRoot, 'unified-deploy', 'local-kind-site.env'),
      failures: [],
      paths: {
        report_path: join(root, 'local-kind-images-fixture.json'),
        log_path: join(root, 'local-kind-images-fixture.log'),
      },
    });
    return;
  }

  if (check.id === 'unified_deploy_local_kind_evidence') {
    writeJson(join(root, 'local-kind-rollout-fixture.json'), {
      schema_version: check.expectedSchemaVersion,
      producer: check.expectedProducer,
      profile: check.expectedProfile,
      status: check.expectedStatus,
      generated_at: generatedAt,
      failures: [],
      paths: {
        report_path: join(root, 'local-kind-rollout-fixture.json'),
        log_path: join(root, 'local-kind-rollout-fixture.log'),
      },
    });
    return;
  }

  if (check.id === 'unified_deploy_product_flow_evidence') {
    const flows = check.expectedProductFlows ?? [];
    const flowEvidence = flows.map((flow) => ({
      schema_version: 'agentsmith.focused-product-flow.evidence/v1',
      flow,
      status: 'passed',
      producer: check.expectedProducer,
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: generatedAt,
      duration_ms: 1,
      checks: {},
    }));
    for (const flow of flowEvidence) {
      writeJson(join(root, `product-flow-${flow.flow}-fixture.json`), flow);
    }
    writeJson(join(root, 'product-flows-fixture.json'), {
      schema_version: check.expectedSchemaVersion,
      producer: check.expectedProducer,
      status: check.expectedStatus,
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: generatedAt,
      flows: flowEvidence,
      flow_evidence_paths: Object.fromEntries(
        flowEvidence.map((flow) => [flow.flow, join(root, `product-flow-${flow.flow}-fixture.json`)]),
      ),
      failures: [],
      paths: {
        report_path: join(root, 'product-flows-fixture.json'),
        log_path: join(root, 'product-flows-fixture.log'),
      },
    });
    return;
  }

  throw new Error(`Unhandled unified deploy evidence fixture: ${check.id}`);
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

function getVisualAutomatedPassCheck(): CurrentVerificationCampaignEvidenceCheck {
  const visualStep = getCampaignStep('lane-visual');
  const visualAutomatedPassCheck = visualStep.evidenceChecks.find(
    (check) => aggregateFixtureEvidenceKind(check) === 'visual_baseline_automated_passes',
  );
  if (!visualAutomatedPassCheck) {
    throw new Error('Missing visual automated-pass evidence check.');
  }
  return visualAutomatedPassCheck;
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
  if (check.semantic === 'unified_deploy_evidence') {
    writeUnifiedDeployEvidenceFixture(campaignRoot, check);
    return;
  }

  const kind = aggregateFixtureEvidenceKind(check);

  if (kind === 'visual_run_manifest') {
    writeVisualRunManifestFixture(campaignRoot);
    return;
  }

  if (kind === 'visual_baseline_automated_passes') {
    for (const scenario of groupVisualBaselineCatalogByScenario().values()) {
      createFile(
        materializeCampaignPath(
          campaignRoot,
          check.path.replaceAll('<visual-scenario-id>', scenario.scenarioId),
        ),
        renderVisualAutomatedPassFixture(campaignRoot, scenario),
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
    const fileCount = Math.max(1, check.minCount ?? 1);
    for (let index = 0; index < fileCount; index += 1) {
      const defaultFileName = check.fileName === '.md'
        ? `report-${index + 1}.md`
        : check.fileName === '.json'
          ? `evidence-${index + 1}.json`
          : (check.fileName ?? `review-${index + 1}.md`);
      createFile(join(path, 'aggregate-fixture', defaultFileName));
    }
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

function buildVisualFixtureBuild(campaignRoot: string) {
  return {
    lane: 'mock-lane' as const,
    runId: resolveCampaignRunId(campaignRoot),
    gitSha: 'aggregate-test-git-sha',
    fingerprint: `${resolveCampaignRunId(campaignRoot)}:mock-lane:visual`,
    startedAt: '2026-04-12T11:59:00.000Z',
  };
}

function renderVisualAutomatedPassFixture(
  campaignRoot: string,
  scenario: VisualBaselineScenarioRecord,
  options: {
    evidenceSnapshot?: VisualBaselineReviewEvidenceSnapshot;
    automatedOverrides?: Partial<{
      generatedAt: string;
      automatedVerdict: 'passed' | 'failed';
      semanticVerdict: 'passed' | 'failed';
      actualUrl: string;
      notes: readonly string[];
    }>;
  } = {},
): string {
  return renderVisualBaselineAutomatedPassMarkdown({
    scenario,
    build: buildVisualFixtureBuild(campaignRoot),
    automated: {
      generatedAt: '2026-04-12T12:00:00.000Z',
      automatedVerdict: 'passed',
      semanticVerdict: 'passed',
      actualUrl: scenario.route,
      notes: ['Aggregate test automated visual pass fixture.'],
      ...options.automatedOverrides,
    },
    evidenceSnapshot: options.evidenceSnapshot ?? buildVisualReviewEvidenceSnapshot(scenario),
  });
}

function writeVisualRunManifestFixture(
  campaignRoot: string,
  overrides: Partial<{
    run_id: string;
    included_scenario_ids: string[];
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
    coverage: Partial<{
      scope: string;
      expected_scenario_ids: string[];
      captured_scenario_ids: string[];
    }>;
  }> = {},
): void {
  const runId = overrides.run_id ?? resolveCampaignRunId(campaignRoot);
  const includedScenarioIds = overrides.included_scenario_ids
    ? new Set(overrides.included_scenario_ids)
    : null;
  const allScenarioIds = [...groupVisualBaselineCatalogByScenario().keys()]
    .sort((left, right) => left.localeCompare(right));
  const scenarios = [...groupVisualBaselineCatalogByScenario().values()]
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
    .filter((scenario) => !includedScenarioIds || includedScenarioIds.has(scenario.scenarioId))
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
  const capturedScenarioIds = scenarios.map((scenario) => scenario.scenario_id);

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
      coverage: {
        scope: overrides.coverage?.scope ?? 'full_catalog',
        expected_scenario_ids: overrides.coverage?.expected_scenario_ids ?? allScenarioIds,
        captured_scenario_ids: overrides.coverage?.captured_scenario_ids ?? capturedScenarioIds,
      },
      scenarios,
    },
  );
}

function overwriteVisualAutomatedPassFixture(
  campaignRoot: string,
  scenarioId: string,
  content: string,
): void {
  const visualAutomatedPassCheck = getVisualAutomatedPassCheck();
  createFile(
    materializeCampaignPath(
      campaignRoot,
      visualAutomatedPassCheck.path.replaceAll('<visual-scenario-id>', scenarioId),
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
  suite: string;
  scenarioId: string;
  storyId: string;
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
  const suite = options.suite ?? 'integration-release-user-story';
  const storyId = options.storyId ?? story.storyId;
  const scenarioId = options.scenarioId ?? 'integration-release-user-story';
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot: traceRoot,
    lane: 'backend-real',
    suite,
    storyId,
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
    story_id: storyId,
    story_source: binding.storySource,
    story_source_fingerprint: buildStorySourceFingerprint(readFileSync(resolve(sourceFile), 'utf8')),
    story_fingerprint: storyFingerprint,
    step_map_fingerprint: stepMapFingerprint,
    scenario_id: scenarioId,
    title: story.title,
    actor: story.actor,
    lane: 'backend-real',
    suite,
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
      bundle_relpath: `backend-real/${suite}/${storyId}/${runId}`,
      review_relpath: `backend-real/${suite}/${storyId}/${runId}/review.md`,
      manifest_relpath: `backend-real/${suite}/${storyId}/${runId}/manifest.json`,
      contract_snapshot_relpath: `backend-real/${suite}/${storyId}/${runId}/contract-snapshot.json`,
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
      required_paths: [{ id: 'evidence_hint', path: evidenceDir, kind: 'path', exists: true }],
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
  it('uses current evidence hint ids for evidenceHints fallback records', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-evidence-hint-id-'));
    try {
      const step: CurrentVerificationCampaignStep = {
        id: 'current-evidence-hint-step',
        gateId: 'current-evidence-hint-gate',
        npmScript: 'test:current-evidence-hint',
        command: 'npm run test:current-evidence-hint',
        workflowRole: 'diagnostic',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'diagnostic',
        defaultFailureClass: 'evidence_missing',
        dependsOn: [],
        evidenceHints: ['<campaign-root>/current-evidence-hint/output.json'],
        evidenceChecks: [],
      };

      const records = evaluateCampaignEvidenceChecks(campaignRoot, step);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: 'evidence_hint',
        path: resolve(campaignRoot, 'current-evidence-hint', 'output.json'),
        kind: 'path',
        exists: false,
      });
      expect(records[0]?.id).not.toContain('legacy');
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlinked campaign step directories before writing evidence or result files', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-step-dir-symlink-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'release-full-step-dir-outside-'));
    const step = getCampaignStep('gate-fast');
    try {
      symlinkSync(outsideRoot, stepDir(campaignRoot, step), 'dir');

      expect(() => writeCampaignGateResult({
        step,
        campaignRoot,
        status: 'passed',
        failureClass: 'none',
        stage: 'complete',
        summary: 'must not write through a symlinked step directory',
      })).toThrow(/symlink/i);
      expect(existsSync(join(outsideRoot, 'result.json'))).toBe(false);

      expect(() => writeCampaignEvidencePointer(campaignRoot, step)).toThrow(/symlink/i);
      expect(existsSync(join(outsideRoot, 'evidence.json'))).toBe(false);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects explicit RELEASE_CAMPAIGN_ROOT under a symlinked parent before preparing writes', () => {
    const apparentRoot = mkdtempSync(join(tmpdir(), 'release-full-explicit-root-parent-symlink-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'release-full-explicit-root-outside-'));
    const runId = 'explicit-safe-id';
    const campaignRoot = join(apparentRoot, 'manual-campaigns', runId);
    try {
      symlinkSync(outsideRoot, join(apparentRoot, 'manual-campaigns'), 'dir');

      expect(() => prepareReleaseCampaignRootForWrite({
        campaignRoot,
        runId,
        env: {
          RELEASE_RUNS_ROOT: join(apparentRoot, 'release-runs'),
        },
      })).toThrow(/symlink/i);
      expect(existsSync(join(outsideRoot, runId))).toBe(false);
    } finally {
      rmSync(apparentRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('pins the current release product-flow proof to the governed required flow list', () => {
    const productFlowEvidence = CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY.unifiedDeployProductFlows.find(
      (artifact): artifact is CurrentGateEvidenceArtifact & { expectedProductFlows: readonly string[] } =>
        artifact.id === 'unified_deploy_product_flow_evidence'
        && Array.isArray(artifact.expectedProductFlows),
    );

    expect(productFlowEvidence?.expectedProductFlows).toEqual(REQUIRED_RELEASE_PRODUCT_FLOWS);
  });

  it('rejects unsafe release campaign run id shapes', () => {
    expect(assertSafeReleaseCampaignRunId('release-ready_20260507T010203Z')).toBe(
      'release-ready_20260507T010203Z',
    );

    for (const runId of [
      '',
      ' ',
      'release ready',
      'release-ready ',
      ' release-ready',
      'release/ready',
      'release\\ready',
      '.',
      '..',
      '../release-ready',
      'release-ready/..',
    ]) {
      expect(() => assertSafeReleaseCampaignRunId(runId)).toThrow(/invalid RELEASE_CAMPAIGN_RUN_ID/);
    }
  });

  it('rejects an unsafe RELEASE_CAMPAIGN_RUN_ID env value at the campaign root resolver boundary', () => {
    const originalRunId = process.env.RELEASE_CAMPAIGN_RUN_ID;
    try {
      process.env.RELEASE_CAMPAIGN_RUN_ID = ' ';
      expect(() => resolveCampaignRoot('release-ready')).toThrow(/invalid RELEASE_CAMPAIGN_RUN_ID/);
    } finally {
      if (originalRunId === undefined) {
        delete process.env.RELEASE_CAMPAIGN_RUN_ID;
      } else {
        process.env.RELEASE_CAMPAIGN_RUN_ID = originalRunId;
      }
    }
  });

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

  it('keeps lane-visual authority manifest generation separate from automated-pass artifact generation', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-visual-fixture-ownership-'));
    const visualAutomatedPassCheck = getVisualAutomatedPassCheck();
    const visualRunManifestCheck = getVisualRunManifestCheck();
    const manifestPath = getVisualRunManifestPath(campaignRoot);

    createManifestEvidenceForCheck(campaignRoot, visualAutomatedPassCheck);

    expect(existsSync(manifestPath)).toBe(false);
    expect(
      existsSync(
        materializeCampaignPath(
          campaignRoot,
          visualAutomatedPassCheck.path.replaceAll('<visual-scenario-id>', 'desktop-auth-complete'),
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

  it('fails when unified deploy evidence is only arbitrary JSON without the producer schema', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-unified-deploy-malformed-'));
    seedPassedCampaign(campaignRoot);

    const substrateStep = getCampaignStep('lane-unified-deploy-substrate');
    const substrateCheck = substrateStep.evidenceChecks.find((check) => check.id === 'unified_deploy_substrate_evidence');
    if (!substrateCheck) {
      throw new Error('Missing unified deploy substrate evidence check.');
    }
    const evidenceRoot = materializeCampaignPath(campaignRoot, substrateCheck.path);
    rmSync(evidenceRoot, { recursive: true, force: true });
    writeJson(join(evidenceRoot, 'arbitrary.json'), { ok: true });
    writeCampaignEvidencePointer(campaignRoot, substrateStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('No JSON evidence file declared schema_version');
  });

  it('fails with infra setup failure when unified deploy infrastructure evidence is failed', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-unified-deploy-infra-failed-'));
    seedPassedCampaign(campaignRoot);

    const substrateStep = getCampaignStep('lane-unified-deploy-substrate');
    const substrateCheck = substrateStep.evidenceChecks.find((check) => check.id === 'unified_deploy_substrate_evidence');
    if (!substrateCheck) {
      throw new Error('Missing unified deploy substrate evidence check.');
    }
    const evidenceRoot = materializeCampaignPath(campaignRoot, substrateCheck.path);
    const substratePath = join(evidenceRoot, 'substrate-lifecycle-reset-fixture.json');
    const substrateEvidence = JSON.parse(readFileSync(substratePath, 'utf8')) as Record<string, unknown>;
    substrateEvidence.status = 'failed';
    substrateEvidence.failure_class = 'evidence_missing';
    substrateEvidence.failures = [{ service: 'postgresql', message: 'reset failed' }];
    writeJson(substratePath, substrateEvidence);
    writeCampaignEvidencePointer(campaignRoot, substrateStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'infra_setup_failure',
    });
    expect(terminalResult.summary).toContain('status must be passed');
  });

  it('fails with product regression when unified deploy product-flow evidence is failed', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-product-flow-regression-'));
    seedPassedCampaign(campaignRoot);

    const productStep = getCampaignStep('lane-unified-deploy-product-flows');
    const productCheck = productStep.evidenceChecks.find((check) => check.id === 'unified_deploy_product_flow_evidence');
    if (!productCheck) {
      throw new Error('Missing unified deploy product flow evidence check.');
    }
    const aggregatePath = join(materializeCampaignPath(campaignRoot, productCheck.path), 'product-flows-fixture.json');
    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as Record<string, unknown>;
    aggregate.status = 'failed';
    aggregate.failure_class = 'product_regression';
    aggregate.failures = [{ flow: 'workspace_project', message: 'workspace/project flow failed' }];
    writeJson(aggregatePath, aggregate);
    writeCampaignEvidencePointer(campaignRoot, productStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'product_regression',
    });
    expect(terminalResult.summary).toContain('status must be passed');
  });

  it('fails when product-flow aggregate is not bound to focused flow evidence files', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-product-flow-unbound-'));
    seedPassedCampaign(campaignRoot);

    const productStep = getCampaignStep('lane-unified-deploy-product-flows');
    const productCheck = productStep.evidenceChecks.find((check) => check.id === 'unified_deploy_product_flow_evidence');
    if (!productCheck) {
      throw new Error('Missing unified deploy product flow evidence check.');
    }
    const aggregatePath = join(materializeCampaignPath(campaignRoot, productCheck.path), 'product-flows-fixture.json');
    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      flow_evidence_paths?: Record<string, string>;
    };
    delete aggregate.flow_evidence_paths?.files;
    writeJson(aggregatePath, aggregate);
    writeCampaignEvidencePointer(campaignRoot, productStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('focused product flow evidence path for files');
  });

  it('fails when product-flow aggregate omits the managed runner required flow', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-product-flow-missing-managed-runner-'));
    seedPassedCampaign(campaignRoot);

    const productStep = getCampaignStep('lane-unified-deploy-product-flows');
    const productCheck = productStep.evidenceChecks.find((check) => check.id === 'unified_deploy_product_flow_evidence');
    if (!productCheck) {
      throw new Error('Missing unified deploy product flow evidence check.');
    }
    const aggregatePath = join(materializeCampaignPath(campaignRoot, productCheck.path), 'product-flows-fixture.json');
    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      flows?: Array<{ flow?: string }>;
      flow_evidence_paths?: Record<string, string>;
    };
    aggregate.flows = aggregate.flows?.filter((flow) => flow.flow !== 'agent_task_managed_runner');
    delete aggregate.flow_evidence_paths?.agent_task_managed_runner;
    writeJson(aggregatePath, aggregate);
    writeCampaignEvidencePointer(campaignRoot, productStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('agent_task_managed_runner');
  });

  it('fails when product-flow aggregate points to focused evidence outside the campaign root', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-product-flow-off-root-'));
    seedPassedCampaign(campaignRoot);

    const productStep = getCampaignStep('lane-unified-deploy-product-flows');
    const productCheck = productStep.evidenceChecks.find((check) => check.id === 'unified_deploy_product_flow_evidence');
    if (!productCheck) {
      throw new Error('Missing unified deploy product flow evidence check.');
    }
    const aggregatePath = join(materializeCampaignPath(campaignRoot, productCheck.path), 'product-flows-fixture.json');
    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      flow_evidence_paths?: Record<string, string>;
    };
    const staleEvidencePath = join(mkdtempSync(join(tmpdir(), 'stale-product-flow-evidence-')), 'files.json');
    writeJson(staleEvidencePath, {
      schema_version: 'agentsmith.focused-product-flow.evidence/v1',
      flow: 'files',
      status: 'passed',
      producer: productCheck.expectedProducer,
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: '2026-05-07T00:00:00.000Z',
      duration_ms: 1,
      checks: {},
    });
    aggregate.flow_evidence_paths = {
      ...(aggregate.flow_evidence_paths ?? {}),
      files: staleEvidencePath,
    };
    writeJson(aggregatePath, aggregate);
    writeCampaignEvidencePointer(campaignRoot, productStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('must stay under');
  });

  it('does not follow symlinked product-flow evidence directories outside the campaign root', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-product-flow-symlink-'));
    seedPassedCampaign(campaignRoot);

    const productStep = getCampaignStep('lane-unified-deploy-product-flows');
    const productCheck = productStep.evidenceChecks.find((check) => check.id === 'unified_deploy_product_flow_evidence');
    if (!productCheck) {
      throw new Error('Missing unified deploy product flow evidence check.');
    }
    const evidenceRoot = materializeCampaignPath(campaignRoot, productCheck.path);
    const staleRoot = mkdtempSync(join(tmpdir(), 'stale-product-flow-root-'));
    const flows = productCheck.expectedProductFlows ?? [];
    for (const flow of flows) {
      writeJson(join(staleRoot, `product-flow-${flow}.json`), {
        schema_version: 'agentsmith.focused-product-flow.evidence/v1',
        flow,
        status: 'passed',
        producer: productCheck.expectedProducer,
        command: 'npm run test:unified-deploy:product-flows',
        generated_at: '2026-05-07T00:00:00.000Z',
        duration_ms: 1,
        checks: {},
      });
    }
    writeJson(join(staleRoot, 'product-flows-fixture.json'), {
      schema_version: productCheck.expectedSchemaVersion,
      producer: productCheck.expectedProducer,
      status: productCheck.expectedStatus,
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: '2026-05-07T00:00:00.000Z',
      flows: flows.map((flow) => ({
        schema_version: 'agentsmith.focused-product-flow.evidence/v1',
        flow,
        status: 'passed',
        producer: productCheck.expectedProducer,
        command: 'npm run test:unified-deploy:product-flows',
      })),
      flow_evidence_paths: Object.fromEntries(
        flows.map((flow) => [flow, join(staleRoot, `product-flow-${flow}.json`)]),
      ),
      failures: [],
    });

    rmSync(evidenceRoot, { recursive: true, force: true });
    mkdirSync(evidenceRoot, { recursive: true });
    symlinkSync(staleRoot, join(evidenceRoot, 'stale-product-flow-root'), 'dir');
    writeCampaignEvidencePointer(campaignRoot, productStep);

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('Expected at least 1 JSON evidence file');
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

  it('fails when backend-real UX trace evidence is semantically self-consistent but outside the current release story membership', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-trace-membership-'));
    seedPassedCampaign(campaignRoot);
    replaceGateReleaseUxTraceWithSemanticBundle(campaignRoot, {
      suite: 'integration-governance-member-workflow-continuity',
      scenarioId: 'integration-governance-member-workflow-continuity',
      storyId: 'governance-member-workflow-continuity',
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
    expect(terminalResult.summary).toContain('integration-release-user-story');
    expect(terminalResult.summary).toContain('release-user-story-end-to-end');
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

  it('rejects unsafe release campaign run ids before resolving a campaign root', () => {
    const escapedRoot = resolve('artifacts', 'release-run-escape');
    try {
      expect(() => runAggregateWithoutExplicitCampaign({
        env: {
          RELEASE_CAMPAIGN_RUN_ID: '../release-run-escape',
        },
      })).toThrow(/invalid RELEASE_CAMPAIGN_RUN_ID/);
      expect(existsSync(escapedRoot)).toBe(false);
    } finally {
      rmSync(escapedRoot, { recursive: true, force: true });
    }
  });

  it('does not treat symlinked release run entries as latest-mode candidates', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-full-aggregate-latest-symlink-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-latest-outside-'));
    const originalCwd = process.cwd();
    const originalUseLatest = process.env.RELEASE_CAMPAIGN_USE_LATEST;
    const originalRunId = process.env.RELEASE_CAMPAIGN_RUN_ID;
    const originalCampaignRoot = process.env.RELEASE_CAMPAIGN_ROOT;
    const originalRunsRoot = process.env.RELEASE_RUNS_ROOT;
    try {
      const releaseRunsRoot = join(root, 'artifacts', 'release-runs');
      mkdirSync(releaseRunsRoot, { recursive: true });
      symlinkSync(outsideRoot, join(releaseRunsRoot, 'release-ready-safe-id'), 'dir');
      process.chdir(root);
      process.env.RELEASE_CAMPAIGN_USE_LATEST = 'true';
      delete process.env.RELEASE_CAMPAIGN_RUN_ID;
      delete process.env.RELEASE_CAMPAIGN_ROOT;
      delete process.env.RELEASE_RUNS_ROOT;

      expect(() => resolveExistingCampaignRoot()).toThrow(/No release campaign run directory|symlink/i);
    } finally {
      process.chdir(originalCwd);
      if (originalUseLatest === undefined) {
        delete process.env.RELEASE_CAMPAIGN_USE_LATEST;
      } else {
        process.env.RELEASE_CAMPAIGN_USE_LATEST = originalUseLatest;
      }
      if (originalRunId === undefined) {
        delete process.env.RELEASE_CAMPAIGN_RUN_ID;
      } else {
        process.env.RELEASE_CAMPAIGN_RUN_ID = originalRunId;
      }
      if (originalCampaignRoot === undefined) {
        delete process.env.RELEASE_CAMPAIGN_ROOT;
      } else {
        process.env.RELEASE_CAMPAIGN_ROOT = originalCampaignRoot;
      }
      if (originalRunsRoot === undefined) {
        delete process.env.RELEASE_RUNS_ROOT;
      } else {
        process.env.RELEASE_RUNS_ROOT = originalRunsRoot;
      }
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
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

  it('fails with contract drift when an automated visual pass omits current build metadata', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-metadata-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario).replace(
        `- build_run_id: ${resolveCampaignRunId(campaignRoot)}\n`,
        '',
      ),
    );

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('automated visual pass metadata');
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

  it('hard fails when lane-visual run-manifest.json declares partial catalog coverage for a release-grade run', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-partial-coverage-'));
    seedPassedCampaign(campaignRoot);
    writeVisualRunManifestFixture(campaignRoot, {
      included_scenario_ids: ['desktop-auth-complete'],
      coverage: {
        scope: 'partial_catalog',
        expected_scenario_ids: ['access-guide', 'desktop-auth-complete'],
        captured_scenario_ids: ['desktop-auth-complete'],
      },
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'evidence_missing',
    });
    expect(terminalResult.summary).toContain('full catalog');
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

  it('passes when lane-visual evidence is automated-pass.md aligned with the run-manifest producer snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-automated-pass-'));
    seedPassedCampaign(campaignRoot);
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('lane-visual'));

    runAggregate(campaignRoot);

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'passed',
      failure_class: 'none',
    });
  });

  it('fails when a lane-visual automated pass drifted away from the run-manifest producer snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-automated-pass-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario, {
        automatedOverrides: {
          actualUrl: '/en-US/drifted-route',
          notes: ['Playwright visual lane completed for this scenario.'],
        },
      }),
    );
    writeCampaignEvidencePointer(campaignRoot, getCampaignStep('lane-visual'));

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('actual_url');
  });

  it('ignores standalone visual review.md artifacts while automated release campaign evidence stays producer-owned', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-review-sidecar-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    createFile(
      resolve(
        campaignRoot,
        'lane-visual',
        'visual-baseline-reviews',
        resolveCampaignRunId(campaignRoot),
        scenario.scenarioId,
        'review.md',
      ),
      [
        `# ${scenario.scenarioId}`,
        '',
        '- schema: visual_baseline_ux_acceptance/v1',
        '- reviewer_kind: human',
      ].join('\n'),
    );

    runAggregate(campaignRoot);

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'passed',
      failure_class: 'none',
    });
  });

  it('passes when automated visual pass stays self-consistent with the producer snapshot even if checkout story fingerprints drift', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-snapshot-owned-pass-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    const customStoryFingerprint = `sha256:${'4'.repeat(64)}`;
    const screenshotFixtures = buildVisualBaselineScenarioEvidence(scenario).screenshots.map((entry, index) => ({
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
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario, {
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

  it('fails with contract drift when automated visual pass build metadata drifts from the run-manifest snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-build-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario).replace(
        '- build_git_sha: aggregate-test-git-sha\n',
        '- build_git_sha: foreign-git-sha\n',
      ),
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

  it('fails with contract drift when automated visual pass hashes drift from committed baselines', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-hash-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    const firstScreenshot = buildVisualBaselineScenarioEvidence(scenario).screenshots[0];
    if (!firstScreenshot) {
      throw new Error('Missing visual screenshot fixture.');
    }
    const baselineHashLine = `- accepted_baseline_hashes: ${buildVisualBaselineScenarioEvidence(scenario).screenshots
      .map((entry) => `${entry.fileName}=sha256:${entry.baselineSha256}`)
      .join('; ')}`;
    const driftedBaselineHashLine = baselineHashLine.replace(
      `${firstScreenshot.fileName}=sha256:${firstScreenshot.baselineSha256}`,
      `${firstScreenshot.fileName}=sha256:${'0'.repeat(64)}`,
    );
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario).replace(
        baselineHashLine,
        driftedBaselineHashLine,
      ),
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

  it('fails with contract drift when automated visual pass story fingerprint drifts', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-story-drift-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario).replace(
        /- story_fingerprint: .+\n/,
        `- story_fingerprint: sha256:${'1'.repeat(64)}\n`,
      ),
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

  it('fails with product regression when automated visual pass automated_verdict is not passed', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-automated-verdict-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario, {
        automatedOverrides: {
          automatedVerdict: 'failed',
        },
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
    expect(terminalResult.summary).toContain('automated_verdict must be passed');
  });

  it('fails with product regression when automated visual pass semantic_verdict is not passed', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-visual-semantic-verdict-'));
    seedPassedCampaign(campaignRoot);
    const scenario = getVisualScenario('desktop-auth-complete');
    overwriteVisualAutomatedPassFixture(
      campaignRoot,
      scenario.scenarioId,
      renderVisualAutomatedPassFixture(campaignRoot, scenario, {
        automatedOverrides: {
          semanticVerdict: 'failed',
        },
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
    expect(terminalResult.summary).toContain('semantic_verdict must be passed');
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

  it('does not accept dummy required paths when manifest-required backend and unified deploy evidence is absent', () => {
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
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('failed result must use a non-none failure_class');
  });

  it('rejects a passed upstream step with a non-none failure class as contract drift', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-passed-step-failure-class-'));
    seedPassedCampaign(campaignRoot);
    const gateDefault = getCampaignStep('gate-default');
    writeCampaignGateResult({
      step: gateDefault,
      campaignRoot,
      status: 'passed',
      failureClass: 'product_regression',
      stage: 'complete',
      summary: 'invalid passed step fixture',
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; gate_id: string; summary: string };
    expect(terminalResult).toMatchObject({
      gate_id: 'gate-release-full',
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('passed result must use failure_class none');
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

  it('fails with contract drift when a campaign wrapper result has an evidence_dir mismatch', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-wrapper-evidence-dir-'));
    seedPassedCampaign(campaignRoot);
    const visualResultPath = resolve(campaignRoot, 'lane-visual', 'result.json');
    const result = JSON.parse(readFileSync(visualResultPath, 'utf8')) as Record<string, unknown>;
    writeJson(visualResultPath, {
      ...result,
      evidence_dir: resolve(campaignRoot, 'other-step'),
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('evidence_dir mismatch');
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

  it('fails with contract drift when an evidence pointer has an evidence_dir mismatch', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-full-aggregate-pointer-evidence-dir-'));
    seedPassedCampaign(campaignRoot);
    const visualEvidencePath = resolve(campaignRoot, 'lane-visual', 'evidence.json');
    const evidence = JSON.parse(readFileSync(visualEvidencePath, 'utf8')) as Record<string, unknown>;
    writeJson(visualEvidencePath, {
      ...evidence,
      evidence_dir: resolve(campaignRoot, 'other-step'),
    });

    expect(() => runAggregate(campaignRoot)).toThrow();

    const terminalResult = JSON.parse(
      readFileSync(resolve(campaignRoot, 'gate-release-full', 'result.json'), 'utf8'),
    ) as { status: string; failure_class: string; summary: string };
    expect(terminalResult).toMatchObject({
      status: 'failed',
      failure_class: 'contract_drift',
    });
    expect(terminalResult.summary).toContain('evidence_dir mismatch');
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
