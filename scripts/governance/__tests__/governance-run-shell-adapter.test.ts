import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildGovernanceRunPlan,
  GOVERNANCE_RUN_PLAN_FILE_NAME,
  GOVERNANCE_RUN_PLAN_SCHEMA,
  GOVERNANCE_RUN_PLAN_VERSION,
  validateGovernanceRunPlan,
} from '../governance-run-plan';
import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA,
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  CURRENT_EVIDENCE_CLAIM_SCOPES,
  CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS,
  CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES,
} from '../current-evidence-claim-schema';
import { runGovernanceCli } from '../run-governance';
import { buildCurrentArtifactTemplateIndex } from '../current-artifact-index-schema';
import { listCurrentJobMetadata } from '../current-job-metadata-manifest';
import { listCurrentResourceLocks } from '../current-resource-lock-manifest';
import { selectGovernanceRunStandaloneJobIds, type GovernanceRunGoal } from '../governance-run-goal-selector';
import { resolveCampaignRunId } from '../release-campaign-io';
import { buildVerificationPlan } from '../verify-impact-selector';

const FORBIDDEN_RUNTIME_KEYS = [
  'status',
  'exists',
  'passed',
  'failed',
  'run_id',
  'exit_code',
  'verdict',
  'claim_id',
  'claim_reuse',
  'cache_hit',
  'reusable',
  'failure_class',
  'artifact_digest',
  'result_digest',
  'input_digest',
  'campaign_root',
  'cache',
] as const;

const FORBIDDEN_RUNTIME_KEY_SET = new Set<string>(FORBIDDEN_RUNTIME_KEYS);
const FORBIDDEN_GOVERNANCE_RUN_SUMMARY_KEYS = [
  'automated_release_verdict',
  'verdict',
  'release_decision',
  'release_verdict',
  'status',
  'passed',
  'failed',
  'exit_code',
  'failure_class',
  'cache_hit',
  'claim_reuse',
  'claim_id',
  'artifact_digest',
  'result_digest',
  'input_digest',
  'digest_claim',
  'commands_executed',
  'current_run_artifact_present',
  'owned_by_current_execution',
  'producer',
  'owner',
] as const;
const FORBIDDEN_GOVERNANCE_RUN_SUMMARY_KEY_SET = new Set<string>(FORBIDDEN_GOVERNANCE_RUN_SUMMARY_KEYS);
const STANDALONE_JOB_VERIFY_COMMANDS: Record<string, string> = {
  'standalone-gate-fast': 'npm run verify:quick',
  'standalone-gate-default': 'npm run verify:default',
  'standalone-lane-visual': 'npm run verify:visual',
  'standalone-lane-backend-real-core': 'npm run verify:real',
};

function collectForbiddenRuntimeKeys(value: unknown, path: string, matches: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenRuntimeKeys(entry, `${path}[${index}]`, matches));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_KEY_SET.has(key)) {
      matches.push(`${path}.${key}`);
    }
    collectForbiddenRuntimeKeys(nested, `${path}.${key}`, matches);
  }
}

function expectNoForbiddenRuntimeKeys(value: unknown, label: string): void {
  const matches: string[] = [];

  collectForbiddenRuntimeKeys(value, 'plan', matches);
  expect(matches, `${label} must not contain forbidden runtime keys`).toEqual([]);
}

function collectForbiddenGovernanceRunSummaryKeys(value: unknown, path: string, matches: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenGovernanceRunSummaryKeys(entry, `${path}[${index}]`, matches));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_GOVERNANCE_RUN_SUMMARY_KEY_SET.has(key)) {
      matches.push(`${path}.${key}`);
    }
    collectForbiddenGovernanceRunSummaryKeys(nested, `${path}.${key}`, matches);
  }
}

function expectNoForbiddenGovernanceRunSummaryKeys(value: unknown): void {
  const matches: string[] = [];

  collectForbiddenGovernanceRunSummaryKeys(value, 'summary', matches);
  expect(matches, 'governance run audit summary must not contain release-truth or evidence-reuse keys').toEqual([]);
}

function expectGovernanceRunSummaryAllowedKeys(value: unknown): void {
  expect(value).toEqual(expect.any(Object));
  const summary = value as {
    campaign?: unknown;
    terminal_aggregate_source?: unknown;
    release_summary_source?: unknown;
  };

  expect(Object.keys(summary), 'governance run summary top-level keys').toEqual([
    'schema',
    'goal',
    'mode',
    'report_root',
    'plan_source',
    'campaign_engine_invoked',
    'campaign_execution_returned',
    'evidence_claims_created',
    'cache_reuse_evaluated',
    'runner_output_scope',
    'campaign',
    'terminal_aggregate_source',
    'release_summary_source',
    'generated_at',
  ]);
  expect(Object.keys(summary.campaign as Record<string, unknown>), 'governance run summary campaign keys').toEqual([
    'id',
    'root',
    'run_id',
  ]);
  expect(
    Object.keys(summary.terminal_aggregate_source as Record<string, unknown>),
    'governance run summary terminal source keys',
  ).toEqual([
    'kind',
    'reference_kind',
    'path',
    'artifact_path_observed',
  ]);
  expect(
    Object.keys(summary.release_summary_source as Record<string, unknown>),
    'governance run summary release source keys',
  ).toEqual([
    'kind',
    'reference_kind',
    'path',
    'artifact_path_observed',
  ]);
}

function captureProcessWrites(action: () => number): { code: number; stdout: string; stderr: string } {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    return {
      code: action(),
      stdout,
      stderr,
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function withTempReportRoot<T>(action: (reportRoot: string) => Promise<T>): Promise<T> {
  const reportRoot = await mkdtemp(join(tmpdir(), 'governance-runner-shell-plan-'));

  try {
    return await action(reportRoot);
  } finally {
    await rm(reportRoot, { recursive: true, force: true });
  }
}

async function readPlanFile(reportRoot: string): Promise<unknown> {
  return JSON.parse(await readFile(join(reportRoot, GOVERNANCE_RUN_PLAN_FILE_NAME), 'utf8')) as unknown;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeFakeNpm(binRoot: string, logPath: string): Promise<void> {
  const npmPath = join(binRoot, 'npm');
  await writeFile(npmPath, `#!/usr/bin/env bash
set -euo pipefail
log_path=${shellSingleQuote(logPath)}
printf '%s|root=%s|run=%s\\n' "$*" "\${RELEASE_CAMPAIGN_ROOT:-}" "\${RELEASE_CAMPAIGN_RUN_ID:-}" >> "$log_path"
if [[ "$1" == "run" && ( "$2" == "release:ready" || "$2" == "test:release:precheck" || "$2" == "release:campaign:full" ) ]]; then
  exit 92
fi
if [[ "$1" == "run" && ( "$2" == "gate:fast" || "$2" == "gate:default" ) ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "lane:visual" ]]; then
  exit 7
fi
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  exit 1
fi
exit 0
`);
  await chmod(npmPath, 0o755);
}

async function withPatchedEnv<T>(
  updates: Record<string, string | undefined>,
  action: () => Promise<T>,
): Promise<T> {
  const originalValues = new Map(Object.keys(updates).map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('governance runner shell adapter', () => {
  it('builds a release plan from current manifests without execution or runtime decision fields', () => {
    const reportRoot = 'artifacts/governance-runner-shell-plan/test';
    const allJobs = listCurrentJobMetadata();
    const jobs = allJobs.filter((job) => job.kind === 'campaign_step');
    const artifactIndex = buildCurrentArtifactTemplateIndex({ jobs });
    const fullArtifactIndex = buildCurrentArtifactTemplateIndex({ jobs: allJobs });
    const plan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot,
    });

    expect(plan).toMatchObject({
      schema: GOVERNANCE_RUN_PLAN_SCHEMA,
      version: GOVERNANCE_RUN_PLAN_VERSION,
      mode: 'plan_only',
      goal: 'release',
      report_root: reportRoot,
      release_decision_produced: false,
      evidence_claims_created: false,
      artifact_directory_inspection: false,
      commands_executed: false,
    });
    expect(Object.keys(plan)).toEqual([
      'schema',
      'version',
      'mode',
      'goal',
      'report_root',
      'release_decision_produced',
      'evidence_claims_created',
      'artifact_directory_inspection',
      'commands_executed',
      'input_manifests',
      'jobs',
      'edges',
      'locks',
      'artifact_templates',
    ]);
    expect(plan.input_manifests).toMatchObject({
      current_job_metadata_manifest: {
        job_count: allJobs.length,
        selected_job_count: jobs.length,
      },
      current_resource_lock_manifest: {
        lock_count: listCurrentResourceLocks().length,
      },
      current_evidence_claim_schema: {
        schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
        top_level_key_count: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS.length,
        scope_count: CURRENT_EVIDENCE_CLAIM_SCOPES.length,
        validation_purpose_count: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.length,
        digest_format: CURRENT_EVIDENCE_CLAIM_SCHEMA.digest_format,
        claim_instances_included: false,
        claim_validation_executed: false,
        claims_created: false,
      },
      current_artifact_template_index: {
        projection_kind: 'declared_template_index',
        artifact_directory_inspection: false,
        creates_evidence_claim: false,
        template_count: fullArtifactIndex.summary.template_count,
        selected_template_count: artifactIndex.summary.template_count,
      },
    });
    expect(plan.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      campaign_id: job.campaign_id,
      gate_id: job.gate_id,
      step_id: job.step_id,
      npm_script: job.npm_script,
      execution_mode: job.execution_mode,
      depends_on: job.depends_on,
      lock_ids: job.lock_ids,
      retry: job.retry,
      cache_policy: job.cache_policy,
      required_secret_names: job.required_secret_names,
      expected_artifact_templates: job.expected_artifact_templates,
    }))).toEqual(jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      campaign_id: job.campaign_id ?? null,
      gate_id: job.gate_id,
      step_id: job.step_id ?? null,
      npm_script: job.npm_script,
      execution_mode: job.execution_mode,
      depends_on: job.depends_on,
      lock_ids: job.locks,
      retry: job.retry,
      cache_policy: job.cache,
      required_secret_names: job.inputs.required_secret_names,
      expected_artifact_templates: job.outputs.expected_artifact_path_templates,
    })));
    for (const job of plan.jobs) {
      expect(job).not.toHaveProperty('cache');
    }
    expect(plan.edges).toEqual(
      jobs.flatMap((job) => job.depends_on.map((dependency) => ({
        from_job_id: dependency,
        to_job_id: job.id,
        relation: 'depends_on',
      }))),
    );
    expect(plan.artifact_templates.map((entry) => ({
      template: entry.template,
      kind: entry.kind,
      required_for: entry.required_for,
      producer_job_id: entry.producer_job_id,
      producer_gate_id: entry.producer_gate_id,
      producer_step_id: entry.producer_step_id,
      producer_npm_script: entry.producer_npm_script,
    }))).toEqual(artifactIndex.templates.map((entry) => ({
      template: entry.template,
      kind: entry.kind,
      required_for: entry.required_for,
      producer_job_id: entry.producer.job_id,
      producer_gate_id: entry.producer.gate_id,
      producer_step_id: entry.producer.step_id,
      producer_npm_script: entry.producer.npm_script,
    })));
    expect(validateGovernanceRunPlan(plan)).toEqual({
      ok: true,
      value: plan,
    });
    expectNoForbiddenRuntimeKeys(plan, 'release shell plan');
  });

  it('accepts governance run plan goals while keeping unknown goals and release-real fail-closed', () => {
    const reportRoot = 'artifacts/governance-runner-shell-plan/test';

    for (const goal of ['debug', 'pr', 'visual', 'real', 'release'] as const) {
      const plan = buildGovernanceRunPlan({
        goal,
        reportRoot,
      });

      expect(plan.goal).toBe(goal);
      expect(validateGovernanceRunPlan(plan)).toEqual({
        ok: true,
        value: plan,
      });
      expectNoForbiddenRuntimeKeys(plan, `${goal} shell plan`);
    }

    expect(() => buildGovernanceRunPlan({
      goal: 'release-real',
      reportRoot,
    })).toThrow(/unsupported governance run goal: release-real/);
    expect(() => buildGovernanceRunPlan({
      goal: 'unknown',
      reportRoot,
    })).toThrow(/unsupported governance run goal: unknown/);
  });

  it('selects standalone jobs for non-release goals and campaign steps for release only', () => {
    const reportRoot = 'artifacts/governance-runner-shell-plan/test';
    const releaseJobIds = listCurrentJobMetadata()
      .filter((job) => job.kind === 'campaign_step')
      .map((job) => job.id);
    const expectedByGoal = {
      debug: ['standalone-gate-fast'],
      visual: ['standalone-gate-fast', 'standalone-gate-default', 'standalone-lane-visual'],
      real: ['standalone-gate-fast', 'standalone-gate-default', 'standalone-lane-backend-real-core'],
      pr: ['standalone-gate-fast', 'standalone-gate-default', 'standalone-lane-backend-real-core'],
      release: releaseJobIds,
    } as const;

    for (const [goal, expectedJobIds] of Object.entries(expectedByGoal)) {
      const plan = buildGovernanceRunPlan({
        goal,
        reportRoot,
      });

      expect(plan.jobs.map((job) => job.id), goal).toEqual(expectedJobIds);
      if (goal === 'release') {
        expect(plan.jobs.every((job) => job.kind === 'campaign_step')).toBe(true);
        expect(plan.jobs.every((job) => job.campaign_id === 'release-full')).toBe(true);
        expect(plan.jobs.every((job) => job.step_id !== null)).toBe(true);
      } else {
        expect(plan.jobs.every((job) => job.kind === 'standalone_gate')).toBe(true);
        expect(plan.jobs.every((job) => job.campaign_id === null)).toBe(true);
        expect(plan.jobs.every((job) => job.step_id === null)).toBe(true);
        expect(plan.artifact_templates.every((entry) => entry.producer_kind === 'standalone_gate')).toBe(true);
        expect(JSON.stringify(plan)).not.toContain('"gate_id":"gate-release-full"');
      }
      expectNoForbiddenRuntimeKeys(plan, `${goal} selected shell plan`);
    }
  });

  it('keeps non-release goal selector mapping aligned with verify selector default semantics', () => {
    for (const goal of ['debug', 'pr', 'visual', 'real'] as const satisfies readonly GovernanceRunGoal[]) {
      const selectedCommands = selectGovernanceRunStandaloneJobIds(goal)
        .map((jobId) => STANDALONE_JOB_VERIFY_COMMANDS[jobId]);
      const verificationPlan = buildVerificationPlan({
        goal,
        run: false,
      });

      expect(selectedCommands, goal).toEqual(verificationPlan.recommendedCommands);
    }
  });

  it('marks the terminal aggregate job as an internal aggregate adapter only', () => {
    const plan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
    });
    const terminal = plan.jobs.find((job) => job.id === 'gate-release-full');

    expect(terminal).toMatchObject({
      adapter_scope: 'internal_adapter',
      aggregate_only: true,
      execution_mode: 'aggregate_only',
    });
    expect(terminal).not.toHaveProperty('command');
    expect(terminal).not.toHaveProperty('release_entrypoint');
    expect(JSON.stringify(terminal)).not.toContain('release execution');
    expectNoForbiddenRuntimeKeys(terminal, 'terminal aggregate job');
  });

  it('filters by current job id and rejects unknown job ids fail-closed', () => {
    const plan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
      jobId: 'gate-release',
    });
    const expectedLockIds = listCurrentJobMetadata()
      .find((job) => job.id === 'gate-release')
      ?.locks ?? [];
    const expectedLockSet = new Set(expectedLockIds);

    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]?.id).toBe('gate-release');
    expect(plan.artifact_templates.every((entry) => entry.producer_job_id === 'gate-release')).toBe(true);
    expect(plan.locks.map((lock) => lock.id).sort()).toEqual(
      listCurrentResourceLocks()
        .filter((lock) => expectedLockSet.has(lock.id))
        .map((lock) => lock.id)
        .sort(),
    );
    expect(() => buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
      jobId: 'unknown-job',
    })).toThrow(/unknown current job id: unknown-job/);
    expectNoForbiddenRuntimeKeys(plan, 'filtered shell plan');
  });

  it('writes only the shell plan file from the CLI run subcommand with status-like path values', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'failed-status-report');
      const result = captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
      ]));
      const written = await readPlanFile(reportRoot);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Governance runner shell plan');
      expect(result.stdout).toContain(GOVERNANCE_RUN_PLAN_FILE_NAME);
      expect(written).toEqual(buildGovernanceRunPlan({
        goal: 'release',
        reportRoot,
      }));
      expectNoForbiddenRuntimeKeys(written, 'written shell plan');
    });
  });

  it('writes a non-release plan-only file without spawning npm or writing a governance summary', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'visual-plan-report');
      const fakeBin = await mkdtemp(join(parentRoot, 'fake-npm-'));
      const logPath = join(parentRoot, 'fake-npm-plan-only.log');
      await writeFakeNpm(fakeBin, logPath);

      const result = await withPatchedEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      }, async () => captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=visual',
        `--report-root=${reportRoot}`,
      ])));
      const written = await readPlanFile(reportRoot);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Governance runner shell plan');
      expect(result.stdout).toContain('Goal: visual');
      expect(written).toEqual(buildGovernanceRunPlan({
        goal: 'visual',
        reportRoot,
      }));
      expect(written).toMatchObject({
        mode: 'plan_only',
        commands_executed: false,
        release_decision_produced: false,
        evidence_claims_created: false,
      });
      await expect(readFile(logPath, 'utf8')).rejects.toThrow();
      await expect(readJsonFile(join(reportRoot, 'governance-run-summary.json'))).rejects.toThrow();
    });
  });

  it('fails closed for non-release --run without spawning npm or writing governance output', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'visual-run-report');
      const fakeBin = await mkdtemp(join(parentRoot, 'fake-npm-'));
      const logPath = join(parentRoot, 'fake-npm-run-closed.log');
      await writeFakeNpm(fakeBin, logPath);

      const result = await withPatchedEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      }, async () => captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=visual',
        `--report-root=${reportRoot}`,
        '--run',
      ])));

      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('governance run --goal=visual --run is not supported');
      expect(result.stderr).toContain('npm run verify -- --goal=visual --run');
      await expect(readFile(logPath, 'utf8')).rejects.toThrow();
      await expect(readPlanFile(reportRoot)).rejects.toThrow();
      await expect(readJsonFile(join(reportRoot, 'governance-run-summary.json'))).rejects.toThrow();
    });
  });

  it('rejects runtime and old-complexity field names by exact key', () => {
    const validPlan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
    });
    const [firstJob, ...remainingJobs] = validPlan.jobs;
    if (!firstJob) {
      throw new Error('expected at least one governance shell plan job.');
    }

    const cases = [
      {
        label: 'top-level status',
        plan: { ...validPlan, status: 'passed' },
        path: 'plan.status',
        key: 'status',
      },
      {
        label: 'nested job status',
        plan: { ...validPlan, jobs: [{ ...firstJob, status: 'passed' }, ...remainingJobs] },
        path: 'plan.jobs[0].status',
        key: 'status',
      },
      {
        label: 'nested job run id',
        plan: { ...validPlan, jobs: [{ ...firstJob, run_id: 'x' }, ...remainingJobs] },
        path: 'plan.jobs[0].run_id',
        key: 'run_id',
      },
      {
        label: 'old bare cache field',
        plan: { ...validPlan, jobs: [{ ...firstJob, cache: 'release_campaign_only' }, ...remainingJobs] },
        path: 'plan.jobs[0].cache',
        key: 'cache',
      },
    ] as const;

    for (const testCase of cases) {
      const validation = validateGovernanceRunPlan(testCase.plan);

      expect(validation.ok, testCase.label).toBe(false);
      if (!validation.ok) {
        expect(validation.failures, testCase.label).toEqual(expect.arrayContaining([
          expect.objectContaining({
            path: testCase.path,
            reason: `forbidden runtime key "${testCase.key}" is not allowed in a shell plan.`,
          }),
        ]));
      }
    }
  });

  it('rejects evidence claim boundary flags when they drift from false', () => {
    const validPlan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
    });
    const falseOnlyFields = [
      'claim_instances_included',
      'claim_validation_executed',
      'claims_created',
    ] as const;

    for (const field of falseOnlyFields) {
      const plan = {
        ...validPlan,
        input_manifests: {
          ...validPlan.input_manifests,
          current_evidence_claim_schema: {
            ...validPlan.input_manifests.current_evidence_claim_schema,
            [field]: true,
          },
        },
      };
      const path = `plan.input_manifests.current_evidence_claim_schema.${field}`;
      const validation = validateGovernanceRunPlan(plan);

      expect(validation.ok, field).toBe(false);
      if (!validation.ok) {
        expect(validation.failures, field).toEqual(expect.arrayContaining([
          expect.objectContaining({
            path,
            reason: `${path} must be false.`,
          }),
        ]));
      }
    }
  });

  it('rejects shell plan node shape drift for object allowlists and array nodes', () => {
    const validPlan = buildGovernanceRunPlan({
      goal: 'release',
      reportRoot: 'artifacts/governance-runner-shell-plan/test',
    });
    const [firstJob, ...remainingJobs] = validPlan.jobs;
    if (!firstJob) {
      throw new Error('expected at least one governance shell plan job.');
    }

    const cases = [
      {
        label: 'input manifests primitive',
        plan: { ...validPlan, input_manifests: 'bad' },
        path: 'plan.input_manifests',
        reason: 'plan.input_manifests must be an object.',
      },
      {
        label: 'jobs primitive',
        plan: { ...validPlan, jobs: 'bad' },
        path: 'plan.jobs',
        reason: 'plan.jobs must be an array.',
      },
      {
        label: 'job primitive entry',
        plan: { ...validPlan, jobs: ['bad', ...remainingJobs] },
        path: 'plan.jobs[0]',
        reason: 'plan.jobs[0] must be an object.',
      },
      {
        label: 'job timeouts primitive',
        plan: { ...validPlan, jobs: [{ ...firstJob, timeouts: 'bad' }, ...remainingJobs] },
        path: 'plan.jobs[0].timeouts',
        reason: 'plan.jobs[0].timeouts must be an object.',
      },
      {
        label: 'job input counts primitive',
        plan: { ...validPlan, jobs: [{ ...firstJob, input_counts: 'bad' }, ...remainingJobs] },
        path: 'plan.jobs[0].input_counts',
        reason: 'plan.jobs[0].input_counts must be an object.',
      },
    ] as const;

    for (const testCase of cases) {
      const validation = validateGovernanceRunPlan(testCase.plan);

      expect(validation.ok, testCase.label).toBe(false);
      if (!validation.ok) {
        expect(validation.failures, testCase.label).toEqual(expect.arrayContaining([
          expect.objectContaining({
            path: testCase.path,
            reason: testCase.reason,
          }),
        ]));
      }
    }
  });

  it('fails closed before writing output when plan selection fails', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'unknown-job-report');
      const result = captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
        '--job-id=unknown-job',
      ]));

      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('unknown current job id: unknown-job');
      await expect(readPlanFile(reportRoot)).rejects.toThrow();
    });
  });

  it('executes the release campaign through --run while writing only audit-owned governance output', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'governance-report');
      const campaignRoot = join(parentRoot, 'release-campaign-root');
      const expectedRunId = basename(campaignRoot);
      const fakeBin = await mkdtemp(join(parentRoot, 'fake-npm-'));
      const logPath = join(parentRoot, 'fake-npm.log');
      await mkdir(campaignRoot, { recursive: true });
      await writeFile(join(campaignRoot, 'summary.json'), '{"sentinel":"campaign-owned-before-run"}\n');
      await writeFakeNpm(fakeBin, logPath);

      const result = await withPatchedEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        RELEASE_CAMPAIGN_ROOT: campaignRoot,
        RELEASE_CAMPAIGN_RUN_ID: 'governance-run-release-test',
      }, async () => captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
        '--run',
      ])));

      const writtenPlan = await readPlanFile(reportRoot);
      const governanceSummaryPath = join(reportRoot, 'governance-run-summary.json');
      const governanceSummary = await readJsonFile(governanceSummaryPath);
      const releaseSummary = await readJsonFile(join(campaignRoot, 'summary.json')) as { schema?: string };
      const log = await readFile(logPath, 'utf8');

      expect(result.code).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Governance runner shell plan');
      expect(log).toContain('run gate:fast|');
      expect(log).toContain('run gate:default|');
      expect(log).toContain('run lane:visual|');
      expect(log).toContain('run gate:release:full|');
      expect(log).not.toContain('run release:ready');
      expect(log).not.toContain('run test:release:precheck');
      expect(log).not.toContain('run release:campaign:full');
      expect(writtenPlan).toEqual(buildGovernanceRunPlan({
        goal: 'release',
        reportRoot,
      }));
      expect(governanceSummary).toMatchObject({
        schema: 'agentsmith_governance_run_summary/v1',
        goal: 'release',
        report_root: reportRoot,
        campaign_engine_invoked: true,
        campaign_execution_returned: true,
        evidence_claims_created: false,
        cache_reuse_evaluated: false,
        runner_output_scope: 'audit_only',
        campaign: {
          id: 'release-full',
          root: campaignRoot,
          run_id: expectedRunId,
        },
        terminal_aggregate_source: {
          path: join(campaignRoot, 'gate-release-full', 'result.json'),
          reference_kind: 'campaign_output_path_reference',
          artifact_path_observed: true,
        },
        release_summary_source: {
          path: join(campaignRoot, 'summary.json'),
          reference_kind: 'campaign_output_path_reference',
          artifact_path_observed: true,
        },
      });
      expectGovernanceRunSummaryAllowedKeys(governanceSummary);
      expectNoForbiddenGovernanceRunSummaryKeys(governanceSummary);
      expect(releaseSummary.schema).toBe('agentsmith_release_summary/v1');
      expect(releaseSummary.schema).not.toBe('agentsmith_governance_run_summary/v1');
    });
  });

  it('uses explicit campaign root identity when RELEASE_CAMPAIGN_ROOT and RELEASE_CAMPAIGN_RUN_ID are both explicit', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'governance-explicit-both-report');
      const campaignRoot = join(parentRoot, 'canonical-campaign-root');
      const envRunId = 'env-run-id-must-not-be-second-identity';
      const expectedRunId = basename(campaignRoot);
      const fakeBin = await mkdtemp(join(parentRoot, 'fake-npm-'));
      const logPath = join(parentRoot, 'fake-npm-explicit-both.log');
      await mkdir(campaignRoot, { recursive: true });
      await writeFakeNpm(fakeBin, logPath);

      const result = await withPatchedEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        RELEASE_CAMPAIGN_ROOT: campaignRoot,
        RELEASE_CAMPAIGN_RUN_ID: envRunId,
      }, async () => captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
        '--run',
      ])));

      const governanceSummary = await readJsonFile(join(reportRoot, 'governance-run-summary.json')) as {
        campaign?: { run_id?: string };
      };
      const releaseSummary = await readJsonFile(join(campaignRoot, 'summary.json')) as {
        campaign_run_id?: string;
      };
      const log = await readFile(logPath, 'utf8');

      expect(result.code).toBe(1);
      expect(result.stderr).toBe('');
      expect(governanceSummary.campaign?.run_id).toBe(expectedRunId);
      expect(releaseSummary.campaign_run_id).toBe(expectedRunId);
      expect(governanceSummary.campaign?.run_id).toBe(releaseSummary.campaign_run_id);
      expect(log).toContain(`run gate:fast|root=${campaignRoot}|run=${expectedRunId}`);
      expect(log).not.toContain(`run=${envRunId}`);
    });
  });

  it('uses campaign IO run identity when only RELEASE_CAMPAIGN_ROOT is explicit', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'governance-root-only-report');
      const campaignRoot = join(parentRoot, 'campaign-owned-run-id');
      const fakeBin = await mkdtemp(join(parentRoot, 'fake-npm-'));
      const logPath = join(parentRoot, 'fake-npm-root-only.log');
      await mkdir(campaignRoot, { recursive: true });
      await writeFakeNpm(fakeBin, logPath);

      const result = await withPatchedEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        RELEASE_CAMPAIGN_ROOT: campaignRoot,
        RELEASE_CAMPAIGN_RUN_ID: undefined,
      }, async () => {
        const expectedRunId = resolveCampaignRunId(campaignRoot);
        const cliResult = captureProcessWrites(() => runGovernanceCli([
          'run',
          '--goal=release',
          `--report-root=${reportRoot}`,
          '--run',
        ]));
        return {
          expectedRunId,
          cliResult,
        };
      });

      const governanceSummary = await readJsonFile(join(reportRoot, 'governance-run-summary.json'));
      const log = await readFile(logPath, 'utf8');

      expect(result.cliResult.code).toBe(1);
      expect(result.cliResult.stderr).toBe('');
      expect(governanceSummary).toMatchObject({
        campaign: {
          root: campaignRoot,
          run_id: result.expectedRunId,
        },
      });
      expect(log).toContain(`run gate:fast|root=${campaignRoot}|run=${result.expectedRunId}`);
      expect(log).not.toContain('run=20');
    });
  });

  it('writes exception-path audit summary without claiming campaign artifacts were produced', async () => {
    await withTempReportRoot(async (parentRoot) => {
      const reportRoot = join(parentRoot, 'governance-throw-report');
      const campaignRoot = join(parentRoot, 'throw-before-spawn-root');
      await mkdir(join(campaignRoot, 'gate-release-full'), { recursive: true });
      await writeFile(join(campaignRoot, 'gate-release-full', 'result.json'), '{"sentinel":"stale-terminal-result"}\n');
      await writeFile(join(campaignRoot, 'summary.json'), '{"sentinel":"stale-release-summary"}\n');

      await withPatchedEnv({
        RELEASE_CAMPAIGN_ROOT: campaignRoot,
        RELEASE_CAMPAIGN_RUN_ID: 'throw-before-spawn',
      }, async () => {
        vi.resetModules();
        vi.doMock('../release-campaign-execution', () => ({
          runReleaseCampaignExecution: () => {
            throw new Error('campaign engine failed before spawn');
          },
        }));

        try {
          const { runGovernanceCli: mockedRunGovernanceCli } = await import('../run-governance');
          const result = captureProcessWrites(() => mockedRunGovernanceCli([
            'run',
            '--goal=release',
            `--report-root=${reportRoot}`,
            '--run',
          ]));
          const governanceSummary = await readJsonFile(join(reportRoot, 'governance-run-summary.json'));

          expect(result.code).toBe(1);
          expect(result.stdout).toContain('Governance runner audit summary');
          expect(result.stderr).toContain('campaign engine failed before spawn');
          expect(governanceSummary).toMatchObject({
            campaign_engine_invoked: true,
            campaign_execution_returned: false,
            campaign: {
              id: 'release-full',
              root: campaignRoot,
              run_id: basename(campaignRoot),
            },
            terminal_aggregate_source: {
              path: join(campaignRoot, 'gate-release-full', 'result.json'),
              reference_kind: 'campaign_output_path_reference',
              artifact_path_observed: true,
            },
            release_summary_source: {
              path: join(campaignRoot, 'summary.json'),
              reference_kind: 'campaign_output_path_reference',
              artifact_path_observed: true,
            },
          });
          expectGovernanceRunSummaryAllowedKeys(governanceSummary);
          expectNoForbiddenGovernanceRunSummaryKeys(governanceSummary);
        } finally {
          vi.doUnmock('../release-campaign-execution');
          vi.resetModules();
        }
      });
    });
  });

  it('fails closed for --run job selection without writing execution output', async () => {
    await withTempReportRoot(async (reportRoot) => {
      const runResult = captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
        '--run',
        '--job-id=gate-fast',
      ]));

      expect(runResult.code).toBe(1);
      expect(runResult.stdout).toBe('');
      expect(runResult.stderr).toContain('partial job execution is not supported');
      await expect(readPlanFile(reportRoot)).rejects.toThrow();
      await expect(readJsonFile(join(reportRoot, 'governance-run-summary.json'))).rejects.toThrow();
    });
  });

  it('keeps the plan builder free of shell execution, artifact scanning, and public script exposure', async () => {
    const [builderSource, selectorSource, cliSource, packageJsonSource] = await Promise.all([
      readFile('scripts/governance/governance-run-plan.ts', 'utf8'),
      readFile('scripts/governance/governance-run-goal-selector.ts', 'utf8'),
      readFile('scripts/governance/run-governance.ts', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);
    const planBuilderSource = `${builderSource}\n${selectorSource}`;
    const adapterSource = `${planBuilderSource}\n${cliSource}`;
    const packageScripts = (JSON.parse(packageJsonSource) as { scripts: Record<string, string> }).scripts;

    expect(adapterSource).not.toMatch(/from ['"]node:child_process['"]/);
    expect(adapterSource).not.toMatch(/\bspawn(?:Sync)?\b/);
    expect(adapterSource).not.toMatch(/\bexec(?:File|FileSync|Sync)?\b/);
    expect(planBuilderSource).not.toMatch(/from ['"]node:fs['"]/);
    expect(adapterSource).not.toMatch(/\b(?:existsSync|readdirSync|statSync|readFileSync|createHash|sha256)\b/);
    expect(adapterSource).not.toMatch(/from ['"]node:crypto['"]/);
    expect(cliSource).toMatch(/import \{ mkdirSync, writeFileSync \} from 'node:fs';/);
    expect(cliSource).not.toContain('release:ready');
    expect(cliSource).not.toContain('test:release:precheck');
    expect(cliSource).not.toContain('release:campaign:full');
    expect(packageScripts).not.toHaveProperty('governance:run');
    expect(packageScripts).not.toHaveProperty('run:governance');
  });
});
