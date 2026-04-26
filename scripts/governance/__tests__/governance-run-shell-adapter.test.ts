import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildGovernanceRunPlan,
  GOVERNANCE_RUN_PLAN_FILE_NAME,
  GOVERNANCE_RUN_PLAN_SCHEMA,
  GOVERNANCE_RUN_PLAN_VERSION,
  validateGovernanceRunPlan,
} from '../governance-run-plan';
import { runGovernanceCli } from '../run-governance';
import { buildCurrentArtifactTemplateIndex } from '../current-artifact-index-schema';
import { listCurrentJobMetadata } from '../current-job-metadata-manifest';
import { listCurrentResourceLocks } from '../current-resource-lock-manifest';

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

describe('governance runner shell adapter', () => {
  it('builds a release plan from current manifests without execution or runtime decision fields', () => {
    const reportRoot = 'artifacts/governance-runner-shell-plan/test';
    const jobs = listCurrentJobMetadata();
    const artifactIndex = buildCurrentArtifactTemplateIndex({ jobs });
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
        job_count: jobs.length,
        selected_job_count: jobs.length,
      },
      current_resource_lock_manifest: {
        lock_count: listCurrentResourceLocks().length,
      },
      current_artifact_template_index: {
        projection_kind: 'declared_template_index',
        artifact_directory_inspection: false,
        creates_evidence_claim: false,
        template_count: artifactIndex.summary.template_count,
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

  it('fails closed for --run and non-release goals without writing an execution plan', async () => {
    await withTempReportRoot(async (reportRoot) => {
      const runResult = captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=release',
        `--report-root=${reportRoot}`,
        '--run',
      ]));
      const unsupportedGoal = captureProcessWrites(() => runGovernanceCli([
        'run',
        '--goal=visual',
        `--report-root=${reportRoot}`,
      ]));

      expect(runResult.code).toBe(1);
      expect(runResult.stdout).toBe('');
      expect(runResult.stderr).toContain('execution not supported in this slice');
      expect(unsupportedGoal.code).toBe(1);
      expect(unsupportedGoal.stdout).toBe('');
      expect(unsupportedGoal.stderr).toContain('goal visual is not supported');
      expect(unsupportedGoal.stderr).toContain('npm run verify -- --goal=visual');
      expect(unsupportedGoal.stderr).toContain('dry-run plan');
      await expect(readPlanFile(reportRoot)).rejects.toThrow();
    });
  });

  it('keeps the adapter source free of shell execution, artifact scanning, and public script exposure', async () => {
    const [builderSource, cliSource, packageJsonSource] = await Promise.all([
      readFile('scripts/governance/governance-run-plan.ts', 'utf8'),
      readFile('scripts/governance/run-governance.ts', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);
    const adapterSource = `${builderSource}\n${cliSource}`;
    const packageScripts = (JSON.parse(packageJsonSource) as { scripts: Record<string, string> }).scripts;

    expect(adapterSource).not.toMatch(/from ['"]node:child_process['"]/);
    expect(adapterSource).not.toMatch(/\bspawn(?:Sync)?\b/);
    expect(adapterSource).not.toMatch(/\bexec(?:File|FileSync|Sync)?\b/);
    expect(builderSource).not.toMatch(/from ['"]node:fs['"]/);
    expect(adapterSource).not.toMatch(/\b(?:existsSync|readdirSync|statSync|readFileSync|createHash|sha256)\b/);
    expect(adapterSource).not.toMatch(/from ['"]node:crypto['"]/);
    expect(cliSource).toMatch(/import \{ mkdirSync, writeFileSync \} from 'node:fs';/);
    expect(packageScripts).not.toHaveProperty('governance:run');
    expect(packageScripts).not.toHaveProperty('run:governance');
  });
});
