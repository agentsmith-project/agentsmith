import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
  CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
} from '../current-artifact-index-schema';
import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA,
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  CURRENT_EVIDENCE_CLAIM_SCOPES,
  CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS,
  CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES,
} from '../current-evidence-claim-schema';
import {
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
} from '../current-job-metadata-manifest';
import {
  CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
  CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
} from '../current-resource-lock-manifest';
import {
  deriveGovernanceResumePlan,
  GOVERNANCE_RESUME_PLAN_SCHEMA,
  GOVERNANCE_RESUME_PLAN_VERSION,
  GOVERNANCE_RUN_STATE_SCHEMA,
  GOVERNANCE_RUN_STATE_VERSION,
  validateGovernanceResumePlan,
  validateGovernanceRunState,
  type GovernanceRunState,
} from '../governance-run-state';
import {
  GOVERNANCE_RUN_PLAN_SCHEMA,
  GOVERNANCE_RUN_PLAN_VERSION,
  type GovernanceRunPlan,
} from '../governance-run-plan';

const DIGEST_INPUT = `sha256:${'1'.repeat(64)}`;
const DIGEST_ARTIFACT = `sha256:${'2'.repeat(64)}`;
const DIGEST_RESULT = `sha256:${'3'.repeat(64)}`;
const DIGEST_CLAIM = `sha256:${'4'.repeat(64)}`;
const DIGEST_PLAN = `sha256:${'5'.repeat(64)}`;
const DIGEST_MANIFEST = `sha256:${'6'.repeat(64)}`;
const DIGEST_SECRET = `sha256:${'7'.repeat(64)}`;
const DIGEST_OTHER = `sha256:${'8'.repeat(64)}`;
const CAMPAIGN_ID = 'release-full';
const RUN_ID = 'release-run-001';
const CAMPAIGN_ROOT = `artifacts/release-runs/${RUN_ID}`;
const GENERATED_AT = '2026-04-25T12:00:00.000Z';

const JOBS = [
  {
    job_id: 'gate-fast',
    gate_id: 'gate-fast',
    step_id: 'gate-fast',
    line_kind: 'release_campaign_preflight',
    npm_script: 'gate:fast',
    depends_on: [] as readonly string[],
  },
  {
    job_id: 'gate-default',
    gate_id: 'gate-default',
    step_id: 'gate-default',
    line_kind: 'release_campaign_default',
    npm_script: 'gate:default',
    depends_on: ['gate-fast'] as readonly string[],
  },
] as const;

type JobId = (typeof JOBS)[number]['job_id'];

function jobById(jobId: JobId) {
  const job = JOBS.find((candidate) => candidate.job_id === jobId);
  if (!job) {
    throw new Error(`missing test job fixture: ${jobId}`);
  }
  return job;
}

function makeRunPlan(): GovernanceRunPlan {
  return {
    schema: GOVERNANCE_RUN_PLAN_SCHEMA,
    version: GOVERNANCE_RUN_PLAN_VERSION,
    mode: 'plan_only',
    goal: 'release',
    report_root: CAMPAIGN_ROOT,
    release_decision_produced: false,
    evidence_claims_created: false,
    artifact_directory_inspection: false,
    commands_executed: false,
    input_manifests: {
      current_job_metadata_manifest: {
        schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
        version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
        job_count: JOBS.length,
        selected_job_count: JOBS.length,
      },
      current_resource_lock_manifest: {
        schema: CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
        version: CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
        lock_count: 1,
        selected_lock_count: 1,
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
        schema: CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
        version: CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
        projection_kind: 'declared_template_index',
        artifact_directory_inspection: false,
        creates_evidence_claim: false,
        template_count: 0,
        selected_template_count: 0,
      },
    },
    jobs: JOBS.map((job) => ({
      id: job.job_id,
      kind: 'campaign_step',
      campaign_id: CAMPAIGN_ID,
      gate_id: job.gate_id,
      step_id: job.step_id,
      npm_script: job.npm_script,
      adapter_scope: 'internal_adapter',
      aggregate_only: false,
      execution_mode: 'execute',
      depends_on: job.depends_on,
      lock_ids: ['release-campaign-root-writes'],
      timeouts: {
        local_seconds: 300,
        ci_seconds: 600,
        source: 'test_fixture',
      },
      retry: 'none',
      cache_policy: 'release_campaign_only',
      required_secret_names: [],
      input_counts: {
        path_glob_count: 0,
        env_profile_count: 0,
        required_secret_count: 0,
      },
      output_counts: {
        expected_artifact_template_count: 0,
      },
      expected_artifact_templates: [],
    })),
    edges: [
      {
        from_job_id: 'gate-fast',
        to_job_id: 'gate-default',
        relation: 'depends_on',
      },
    ],
    locks: [
      {
        id: 'release-campaign-root-writes',
        category: 'campaign_root',
        scope: 'campaign',
        mode: 'exclusive',
        enforcement: 'modeled_only',
        owner_counts: {
          gate_id_count: 2,
          npm_script_count: 2,
          command_surface_count: 0,
        },
        applies_to_counts: {
          gate_id_count: 2,
          npm_script_count: 2,
          runtime_line_count: 0,
          path_count: 1,
          port_count: 0,
          provider_profile_count: 0,
        },
      },
    ],
    artifact_templates: [],
  };
}

function makeClaim(jobId: JobId, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const job = jobById(jobId);

  return {
    schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    subject: `release.${jobId}`,
    scope: 'release',
    campaign_id: CAMPAIGN_ID,
    campaign_root: CAMPAIGN_ROOT,
    run_id: RUN_ID,
    step_id: job.step_id,
    gate_id: job.gate_id,
    line_kind: job.line_kind,
    gate_adapter: {
      npm_script: job.npm_script,
    },
    evidence_dir: `${CAMPAIGN_ROOT}/${job.step_id}`,
    result_status: 'passed',
    failure_class: 'none',
    input_digest: {
      value: DIGEST_INPUT,
    },
    artifact_digest: {
      value: DIGEST_ARTIFACT,
    },
    result_digest: DIGEST_RESULT,
    producer: {
      origin: 'test',
    },
    freshness: {
      git_sha: 'abc1234',
      allow_cross_commit: false,
      allow_cross_secret_profile: false,
      secret_profile_digest: DIGEST_SECRET,
    },
    validator: {
      name: 'current-evidence-claim-schema',
      version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    },
    generated_at: GENERATED_AT,
    ...overrides,
  };
}

function makeState(
  overrides: {
    jobs?: Record<JobId, Partial<GovernanceRunState['jobs'][number]>>;
    topLevel?: Partial<GovernanceRunState> & Record<string, unknown>;
  } = {},
): GovernanceRunState {
  return {
    schema: GOVERNANCE_RUN_STATE_SCHEMA,
    version: GOVERNANCE_RUN_STATE_VERSION,
    campaign: {
      campaign_id: CAMPAIGN_ID,
      campaign_root: CAMPAIGN_ROOT,
      run_id: RUN_ID,
    },
    fingerprints: {
      run_plan_digest: DIGEST_PLAN,
      manifest_digest: DIGEST_MANIFEST,
    },
    jobs: JOBS.map((job) => ({
      job_id: job.job_id,
      gate_id: job.gate_id,
      step_id: job.step_id,
      line_kind: job.line_kind,
      lifecycle: 'completed',
      attempts: [
        {
          attempt_id: `${job.job_id}-attempt-1`,
          lifecycle: 'completed',
          started_at: GENERATED_AT,
          finished_at: GENERATED_AT,
        },
      ],
      lock_leases: [
        {
          lock_id: 'release-campaign-root-writes',
          scope_key: CAMPAIGN_ROOT,
          owner_attempt_id: `${job.job_id}-attempt-1`,
          mode: 'exclusive',
        },
      ],
      result_ref: {
        result_status: 'passed',
        failure_class: 'none',
        result_digest: DIGEST_RESULT,
      },
      evidence_ref: {
        evidence_dir: `${CAMPAIGN_ROOT}/${job.step_id}`,
        artifact_digest: DIGEST_ARTIFACT,
      },
      claim_ref: {
        claim_id: `${job.job_id}-claim`,
        claim_digest: DIGEST_CLAIM,
        evidence_dir: `${CAMPAIGN_ROOT}/${job.step_id}`,
        input_digest: DIGEST_INPUT,
        artifact_digest: DIGEST_ARTIFACT,
        result_digest: DIGEST_RESULT,
        result_status: 'passed',
        failure_class: 'none',
        secret_profile_digest: DIGEST_SECRET,
      },
      ...(overrides.jobs?.[job.job_id] ?? {}),
    })),
    ...(overrides.topLevel ?? {}),
  };
}

function makeResumeInput(state = makeState(), claims = JOBS.map((job) => makeClaim(job.job_id))) {
  return {
    run_plan: makeRunPlan(),
    run_state: state,
    current_manifests: {
      run_plan_digest: DIGEST_PLAN,
      manifest_digest: DIGEST_MANIFEST,
      jobs: JOBS.map((job) => ({
        job_id: job.job_id,
        gate_id: job.gate_id,
        step_id: job.step_id,
        line_kind: job.line_kind,
        secret_profile_digest: DIGEST_SECRET,
      })),
    },
    claim_validation_inputs: claims.map((claim, index) => ({
      job_id: JOBS[index]?.job_id ?? 'unknown',
      claim_id: `${JOBS[index]?.job_id ?? 'unknown'}-claim`,
      purpose: 'reuse' as const,
      claim,
    })),
  };
}

function resumeJobFor(plan: ReturnType<typeof deriveGovernanceResumePlan>, jobId: string) {
  const job = plan.jobs.find((candidate) => candidate.job_id === jobId);
  if (!job) {
    throw new Error(`missing resume job: ${jobId}`);
  }
  return job;
}

function actionFor(plan: ReturnType<typeof deriveGovernanceResumePlan>, jobId: JobId) {
  return resumeJobFor(plan, jobId).next_action;
}

describe('governance run state and resume plan model', () => {
  it('rejects second release verdict/truth and execution/cache fields anywhere in run state or resume plan', () => {
    for (const forbiddenField of [
      'verdict',
      'release_verdict',
      'automated_release_verdict',
      'release_decision',
      'commands_executed',
      'cache_hit',
      'claim_reuse',
    ]) {
      expect(validateGovernanceRunState({
        ...makeState(),
        [forbiddenField]: false,
      }).ok).toBe(false);

      expect(validateGovernanceRunState(makeState({
        jobs: {
          'gate-fast': {
            claim_ref: {
              ...makeState().jobs[0]!.claim_ref!,
              [forbiddenField]: true,
            },
          },
        },
      })).ok).toBe(false);
    }

    const resume = deriveGovernanceResumePlan(makeResumeInput());

    expect(validateGovernanceResumePlan({
      ...resume,
      release_decision: 'passed',
    }).ok).toBe(false);
    expect(validateGovernanceResumePlan({
      ...resume,
      jobs: [
        {
          ...resume.jobs[0]!,
          cache_hit: true,
        },
      ],
    }).ok).toBe(false);
  });

  it('passes a valid run state and generated resume plan without release truth fields', () => {
    const state = makeState();
    const resume = deriveGovernanceResumePlan(makeResumeInput(state));

    expect(validateGovernanceRunState(state)).toEqual({
      ok: true,
      value: state,
    });
    expect(resume).toMatchObject({
      schema: GOVERNANCE_RESUME_PLAN_SCHEMA,
      version: GOVERNANCE_RESUME_PLAN_VERSION,
      campaign: {
        campaign_id: CAMPAIGN_ID,
        campaign_root: CAMPAIGN_ROOT,
        run_id: RUN_ID,
      },
    });
    expect(validateGovernanceResumePlan(resume)).toEqual({
      ok: true,
      value: resume,
    });
    expect(JSON.stringify(resume)).not.toMatch(
      /verdict|release_verdict|automated_release_verdict|release_decision|commands_executed|cache_hit|claim_reuse/,
    );
  });

  it('keeps skipped as job lifecycle only and rejects skipped result statuses', () => {
    const skippedLifecycleState = makeState({
      jobs: {
        'gate-fast': {
          lifecycle: 'skipped',
          result_ref: {
            result_status: 'failed',
            failure_class: 'evidence_missing',
            result_digest: DIGEST_RESULT,
          },
          claim_ref: {
            ...makeState().jobs[0]!.claim_ref!,
            result_status: 'failed',
            failure_class: 'evidence_missing',
          },
        },
      },
    });
    const skippedResultStatusState = {
      ...makeState(),
      jobs: [
        {
          ...makeState().jobs[0]!,
          result_ref: {
            ...makeState().jobs[0]!.result_ref!,
            result_status: 'skipped',
          },
        },
        makeState().jobs[1]!,
      ],
    };
    const skippedClaimStatusState = {
      ...makeState(),
      jobs: [
        {
          ...makeState().jobs[0]!,
          claim_ref: {
            ...makeState().jobs[0]!.claim_ref!,
            result_status: 'skipped',
          },
        },
        makeState().jobs[1]!,
      ],
    };

    expect(validateGovernanceRunState(skippedLifecycleState).ok).toBe(true);
    expect(validateGovernanceRunState(skippedResultStatusState).ok).toBe(false);
    expect(validateGovernanceRunState(skippedClaimStatusState).ok).toBe(false);
  });

  it('rejects duplicate state job ids and result failure-class mismatches', () => {
    expect(validateGovernanceRunState({
      ...makeState(),
      jobs: [
        makeState().jobs[0]!,
        {
          ...makeState().jobs[1]!,
          job_id: 'gate-fast',
        },
      ],
    }).ok).toBe(false);

    expect(validateGovernanceRunState(makeState({
      jobs: {
        'gate-fast': {
          result_ref: {
            result_status: 'passed',
            failure_class: 'product_regression',
            result_digest: DIGEST_RESULT,
          },
        },
      },
    })).ok).toBe(false);

    expect(validateGovernanceRunState(makeState({
      jobs: {
        'gate-fast': {
          claim_ref: {
            ...makeState().jobs[0]!.claim_ref!,
            result_status: 'failed',
            failure_class: 'none',
          },
        },
      },
    })).ok).toBe(false);
  });

  it('reuses a valid passed claim that matches state, plan, manifests, campaign, run, step, gate, line, and secret profile', () => {
    const resume = deriveGovernanceResumePlan(makeResumeInput());

    expect(actionFor(resume, 'gate-fast')).toBe('reuse_claim');
    expect(actionFor(resume, 'gate-default')).toBe('reuse_claim');
    expect(resume.jobs[0]).toMatchObject({
      claim_ref: {
        claim_id: 'gate-fast-claim',
        evidence_dir: `${CAMPAIGN_ROOT}/gate-fast`,
        input_digest: DIGEST_INPUT,
        artifact_digest: DIGEST_ARTIFACT,
        result_digest: DIGEST_RESULT,
      },
    });
  });

  it.each([
    {
      label: 'unknown dependency',
      reasonCode: 'unknown_dependency',
      mutatePlan: (plan: GovernanceRunPlan): GovernanceRunPlan => ({
        ...plan,
        jobs: plan.jobs.map((job) => job.id === 'gate-default'
          ? { ...job, depends_on: ['missing-upstream'] }
          : job),
      }),
    },
    {
      label: 'dependency cycle',
      reasonCode: 'dependency_cycle',
      mutatePlan: (plan: GovernanceRunPlan): GovernanceRunPlan => ({
        ...plan,
        jobs: plan.jobs.map((job) => {
          if (job.id === 'gate-fast') {
            return { ...job, depends_on: ['gate-default'] };
          }
          if (job.id === 'gate-default') {
            return { ...job, depends_on: ['gate-fast'] };
          }
          return job;
        }),
      }),
    },
    {
      label: 'duplicate plan job id',
      reasonCode: 'duplicate_plan_job_id',
      mutatePlan: (plan: GovernanceRunPlan): GovernanceRunPlan => ({
        ...plan,
        jobs: [
          ...plan.jobs,
          {
            ...plan.jobs[1]!,
            id: 'gate-fast',
          },
        ],
      }),
    },
  ])('invalidates instead of reusing claims when the plan graph has $label', ({ mutatePlan, reasonCode }) => {
    const input = makeResumeInput();
    input.run_plan = mutatePlan(input.run_plan);

    const resume = deriveGovernanceResumePlan(input);

    expect(resume.jobs.every((job) => job.next_action === 'invalidated')).toBe(true);
    expect(resume.jobs.some((job) => job.reason_codes.includes(reasonCode))).toBe(true);
    expect(resume.jobs.map((job) => job.next_action)).not.toContain('reuse_claim');
    expect(validateGovernanceResumePlan(resume).ok).toBe(true);
  });

  it('invalidates when run state campaign_root and run plan report_root diverge', () => {
    const input = makeResumeInput();
    input.run_plan = {
      ...input.run_plan,
      report_root: 'artifacts/release-runs/other-run',
    };

    const resume = deriveGovernanceResumePlan(input);

    expect(resume.jobs.every((job) => job.next_action === 'invalidated')).toBe(true);
    expect(resume.jobs.every((job) => job.claim_ref === null)).toBe(true);
    expect(resume.jobs[0]?.reason_codes).toContain('campaign_root_report_root_mismatch');
  });

  it('rejects resume plans whose claim_ref does not match the next_action', () => {
    const resume = deriveGovernanceResumePlan(makeResumeInput());

    expect(validateGovernanceResumePlan({
      ...resume,
      jobs: [
        {
          ...resume.jobs[0]!,
          claim_ref: null,
        },
        resume.jobs[1]!,
      ],
    }).ok).toBe(false);

    expect(validateGovernanceResumePlan({
      ...resume,
      jobs: [
        {
          ...resume.jobs[0]!,
          next_action: 'rerun_required',
          reason_codes: ['missing_claim_ref'],
        },
        resume.jobs[1]!,
      ],
    }).ok).toBe(false);
  });

  it.each([
    [
      'failed',
      makeState({
        jobs: {
          'gate-fast': {
            result_ref: {
              result_status: 'failed',
              failure_class: 'product_regression',
              result_digest: DIGEST_RESULT,
            },
            claim_ref: {
              ...makeState().jobs[0]!.claim_ref!,
              result_status: 'failed',
              failure_class: 'product_regression',
            },
          },
        },
      }),
      [makeClaim('gate-fast', { result_status: 'failed', failure_class: 'product_regression' }), makeClaim('gate-default')],
    ],
    [
      'skipped lifecycle with failed canonical result',
      makeState({
        jobs: {
          'gate-fast': {
            lifecycle: 'skipped',
            result_ref: {
              result_status: 'failed',
              failure_class: 'evidence_missing',
              result_digest: DIGEST_RESULT,
            },
            claim_ref: {
              ...makeState().jobs[0]!.claim_ref!,
              result_status: 'failed',
              failure_class: 'evidence_missing',
            },
          },
        },
      }),
      [makeClaim('gate-fast', { result_status: 'failed', failure_class: 'evidence_missing' }), makeClaim('gate-default')],
    ],
    [
      'malformed digest',
      makeState(),
      [makeClaim('gate-fast', { input_digest: { value: `sha256:${'A'.repeat(64)}` } }), makeClaim('gate-default')],
    ],
    [
      'missing digest',
      makeState({
        jobs: {
          'gate-fast': {
            claim_ref: {
              ...makeState().jobs[0]!.claim_ref!,
              input_digest: null,
            },
          },
        },
      }),
      [makeClaim('gate-fast'), makeClaim('gate-default')],
    ],
    [
      'secret profile mismatch',
      makeState(),
      [makeClaim('gate-fast', {
        freshness: {
          git_sha: 'abc1234',
          allow_cross_commit: false,
          allow_cross_secret_profile: false,
          secret_profile_digest: DIGEST_OTHER,
        },
      }), makeClaim('gate-default')],
    ],
    [
      'campaign root mismatch',
      makeState(),
      [makeClaim('gate-fast', { campaign_root: 'artifacts/release-runs/other-run' }), makeClaim('gate-default')],
    ],
    [
      'run id mismatch',
      makeState(),
      [makeClaim('gate-fast', { run_id: 'other-run' }), makeClaim('gate-default')],
    ],
  ])('does not reuse when the upstream claim is %s', (_label, state, claims) => {
    const resume = deriveGovernanceResumePlan(makeResumeInput(state, claims));

    expect(actionFor(resume, 'gate-fast')).toBe('rerun_required');
    expect(actionFor(resume, 'gate-default')).toBe('blocked_by_upstream');
  });

  it('rejects reusable claim evidence directories that escape the campaign root', () => {
    const escapedState = makeState({
      jobs: {
        'gate-fast': {
          evidence_ref: {
            evidence_dir: `${CAMPAIGN_ROOT}/gate-fast/../../outside`,
            artifact_digest: DIGEST_ARTIFACT,
          },
          claim_ref: {
            ...makeState().jobs[0]!.claim_ref!,
            evidence_dir: `${CAMPAIGN_ROOT}/gate-fast/../../outside`,
          },
        },
      },
    });

    const validation = validateGovernanceRunState(escapedState);
    const resume = deriveGovernanceResumePlan(makeResumeInput(escapedState, [
      makeClaim('gate-fast', { evidence_dir: `${CAMPAIGN_ROOT}/gate-fast/../../outside` }),
      makeClaim('gate-default'),
    ]));

    expect(validation.ok).toBe(false);
    expect(actionFor(resume, 'gate-fast')).toBe('invalidated');
    expect(actionFor(resume, 'gate-default')).toBe('blocked_by_upstream');
  });

  it('fails closed when an absolute evidence directory only contains the relative campaign root', () => {
    const absoluteDir = `/tmp/${CAMPAIGN_ROOT}/gate-fast`;
    const escapedState = makeState({
      jobs: {
        'gate-fast': {
          evidence_ref: {
            evidence_dir: absoluteDir,
            artifact_digest: DIGEST_ARTIFACT,
          },
          claim_ref: {
            ...makeState().jobs[0]!.claim_ref!,
            evidence_dir: absoluteDir,
          },
        },
      },
    });

    const validation = validateGovernanceRunState(escapedState);
    const resume = deriveGovernanceResumePlan(makeResumeInput(escapedState, [
      makeClaim('gate-fast', { evidence_dir: absoluteDir }),
      makeClaim('gate-default'),
    ]));

    expect(validation.ok).toBe(false);
    expect(actionFor(resume, 'gate-fast')).toBe('invalidated');
    expect(actionFor(resume, 'gate-default')).toBe('blocked_by_upstream');
  });

  it('blocks downstream reuse when a dependency cannot be reused', () => {
    const resume = deriveGovernanceResumePlan(makeResumeInput(makeState({
      jobs: {
        'gate-fast': {
          claim_ref: null,
        },
      },
    })));

    expect(actionFor(resume, 'gate-fast')).toBe('rerun_required');
    expect(actionFor(resume, 'gate-default')).toBe('blocked_by_upstream');
  });

  it('validates modeled lock lease shape without acquiring locks', () => {
    const state = makeState();

    expect(validateGovernanceRunState(state).ok).toBe(true);
    expect(validateGovernanceRunState(makeState({
      jobs: {
        'gate-fast': {
          lock_leases: [
            {
              lock_id: 'release-campaign-root-writes',
              scope_key: CAMPAIGN_ROOT,
              owner_attempt_id: 'gate-fast-attempt-1',
              mode: 'shared_read',
            },
          ],
        },
      },
    })).ok).toBe(true);
    expect(validateGovernanceRunState(makeState({
      jobs: {
        'gate-fast': {
          lock_leases: [
            {
              lock_id: 'release-campaign-root-writes',
              scope_key: CAMPAIGN_ROOT,
              owner_attempt_id: 'missing-attempt',
              mode: 'exclusive',
            },
          ],
        },
      },
    })).ok).toBe(false);
    expect(validateGovernanceRunState(makeState({
      jobs: {
        'gate-fast': {
          lock_leases: [
            {
              lock_id: 'release-campaign-root-writes',
              scope_key: CAMPAIGN_ROOT,
              owner_attempt_id: 'gate-fast-attempt-1',
              mode: 'write_lock',
            },
          ],
        },
      },
    })).ok).toBe(false);
  });

  it('does not implement execution, artifact scanning, or digest computation in the model source', async () => {
    const source = await readFile('scripts/governance/governance-run-state.ts', 'utf8');

    for (const forbiddenToken of [
      'child_process',
      'existsSync',
      'readdirSync',
      'statSync',
      'createHash',
    ]) {
      expect(source).not.toContain(forbiddenToken);
    }
  });
});
