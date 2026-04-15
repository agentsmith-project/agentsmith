import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

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
  groupVisualBaselineCatalogByScenario,
  renderVisualBaselineScenarioReviewMarkdown,
  type VisualBaselineReviewRecord,
  type VisualBaselineScenarioRecord,
} from '../../../e2e/visual-baseline-support';

type RunAggregateOptions = {
  env?: NodeJS.ProcessEnv;
};

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

function createFile(path: string, content = 'aggregate evidence fixture\n'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function createManifestEvidenceForCheck(
  campaignRoot: string,
  check: CurrentVerificationCampaignEvidenceCheck,
): void {
  if (check.kind === 'visual_baseline_reviews') {
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
  if (check.kind === 'file') {
    if (!existsSync(path)) {
      createFile(path);
    }
    return;
  }

  if (check.kind === 'directory') {
    createDirectory(path);
    return;
  }

  if (check.kind === 'directory_non_empty') {
    createDirectory(path);
    if (path.startsWith(`${campaignRoot}/`)) {
      createFile(join(path, '.aggregate-fixture'));
    }
    return;
  }

  createFile(
    join(path, 'aggregate-fixture', check.fileName === '.md' ? 'report.md' : (check.fileName ?? 'review.md')),
  );
}

function createManifestEvidence(campaignRoot: string, step: CurrentVerificationCampaignStep): void {
  for (const check of step.evidenceChecks) {
    createManifestEvidenceForCheck(campaignRoot, check);
  }
}

function renderVisualReviewFixture(
  campaignRoot: string,
  scenario: VisualBaselineScenarioRecord,
  reviewOverrides: Partial<VisualBaselineReviewRecord> = {},
  options: { includeBuild?: boolean } = {},
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
      reviewer: 'aggregate-test',
      reviewedAt: '2026-04-12T12:00:00.000Z',
      verdict: 'aligned',
      cursorFit: 'aligned',
      uxFit: 'low_mindload',
      notes: ['Aggregate test visual review fixture.'],
      ...reviewOverrides,
    },
  });
}

function overwriteVisualReviewFixture(
  campaignRoot: string,
  scenarioId: string,
  content: string,
): void {
  const visualStep = getCampaignStep('lane-visual');
  const visualReviewCheck = visualStep.evidenceChecks.find((check) => check.kind === 'visual_baseline_reviews');
  if (!visualReviewCheck) {
    throw new Error('Missing visual review evidence check.');
  }
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
  });

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
    expect(terminalResult.summary).toContain('visual review metadata');
  });

  it('fails with product regression when a visual review verdict is not aligned', () => {
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
    expect(terminalResult.summary).toContain('verdict must be aligned');
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
