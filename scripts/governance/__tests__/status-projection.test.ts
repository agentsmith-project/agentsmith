import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
  validateCurrentStatusProjection,
} from '../current-status-projection-schema';
import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';
import { buildMinimalLeaseStatusShadow, resolveMinimalLeaseStatusShadow } from '../lease-status-shadow';
import {
  buildStatusProjection,
  renderShortFailureProjection,
  renderStatusProjection,
  renderStatusProjectionSummary,
} from '../status-projection';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const CURRENT_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVIDENCE_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_EVIDENCE_GIT_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SENSITIVE_AGGREGATE_SUMMARY = [
  'Campaign step gate-release did not pass.',
  'Authorization: Bearer projection-bearer-raw-token',
  'OPENAI_API_KEY=sk-projection-raw-value',
  'api_key=projection-api-key-raw-value',
  'access_token=projection-access-token-raw-value',
  'refresh_token=projection-refresh-token-raw-value',
  'oauth_token=projection-oauth-token-raw-value',
  'client_secret=projection-client-secret-raw-value',
  'password=projection-password-raw-value',
  'managed_credentials: {"feishu":"projection-managed-credential-object-raw-value"}',
  'password: {"value":"projection-password-object-raw-value"}',
  'ticket=projection-ticket-raw-value',
  'managed_credentials.feishu=projection-managed-credential-raw-value',
  'Cookie: sid=projection-cookie-raw-value',
].join(' ');
const SENSITIVE_PROJECTION_FRAGMENTS = [
  'projection-bearer-raw-token',
  'sk-projection-raw-value',
  'projection-api-key-raw-value',
  'projection-access-token-raw-value',
  'projection-refresh-token-raw-value',
  'projection-oauth-token-raw-value',
  'projection-client-secret-raw-value',
  'projection-password-raw-value',
  'projection-managed-credential-object-raw-value',
  'projection-password-object-raw-value',
  'projection-ticket-raw-value',
  'projection-managed-credential-raw-value',
  'projection-cookie-raw-value',
];
const PREBUILT_SCOPE_KIND_SECRET = 'sk-status-prebuilt-scope-kind-secret-1234567';
const PREBUILT_MODE_SECRET = 'api_key=status-prebuilt-mode-api-key-raw-value';
const PREBUILT_OWNER_SECRET = 'sk-status-prebuilt-owner-secret-1234567';
const PREBUILT_TICKET_SECRET = 'ticket=status-prebuilt-ticket-raw-value';

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeAggregateResult(campaignRoot: string, overrides: Partial<{
  status: string;
  failure_class: string;
  stage: string;
  summary: string;
  generated_at: string;
}> = {}): string {
  const payload = {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: overrides.summary ?? 'Release-full campaign evidence passed aggregate verification.',
    generated_at: overrides.generated_at ?? GENERATED_AT,
  };
  const path = join(campaignRoot, 'gate-release-full', 'result.json');
  writeJson(path, payload);
  return path;
}

function writeReleaseSummaryWithObservability(campaignRoot: string): void {
  writeJson(join(campaignRoot, 'summary.json'), {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: campaignRoot.split('/').at(-1) ?? 'release-status-observability',
    campaign_root: campaignRoot,
    automated_release_verdict: 'PASSED',
    status: 'passed',
    failure_class: 'none',
    stage: 'aggregate',
    blocked_step: null,
    why: 'Release-full campaign evidence passed aggregate verification.',
    next_action: 'Attach summary.md to the release note and complete the operator sign-off checklist.',
    terminal_result_path: join(campaignRoot, 'gate-release-full', 'result.json'),
    summary_json_path: join(campaignRoot, 'summary.json'),
    summary_md_path: join(campaignRoot, 'summary.md'),
    evidence_package: campaignRoot,
    manual_operator_signoff: 'not_covered',
    generated_at: GENERATED_AT,
    deploy_check_snapshot: releaseDeployCheckSnapshot(campaignRoot),
    run_observability: {
      total_duration_ms: 5_432_100,
      top_slow_stages: [
        {
          id: 'gate-release',
          label: 'Backend real release check',
          duration_ms: 2_765_000,
          status: 'passed',
        },
        {
          id: 'lane-visual',
          label: 'Full visual check',
          duration_ms: 1_011_000,
          status: 'passed',
        },
        {
          id: 'lane-unified-deploy-product-flows',
          label: 'Deploy product flows',
          duration_ms: 165_000,
          status: 'passed',
        },
      ],
      counts_source: 'parent_flow',
      counts: {
        real_service_start_count: 1,
        api_web_start_count: 1,
        backend_real_check_session_count: 2,
        image_import_count: 3,
      },
      poll_retry_coverage: 'not_covered',
      report_size_bytes: 987_654,
    },
  });
}

function writeFailedCampaignStepResult(campaignRoot: string, stepId = 'gate-default'): string {
  const path = join(campaignRoot, stepId, 'result.json');
  writeJson(path, {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: stepId,
    gate_adapter: {
      npm_script: `gate:${stepId}`,
      ci_job: null,
    },
    status: 'failed',
    failure_class: 'product_regression',
    stage: 'execute',
    line_kind: 'release_campaign_step',
    evidence_dir: join(campaignRoot, stepId),
    summary: `Release campaign step ${stepId} failed with exit code 6.`,
    generated_at: GENERATED_AT,
  });
  return path;
}

function writeDeployStepResult(campaignRoot: string, stepId: string, status: 'passed' | 'failed'): void {
  writeJson(join(campaignRoot, stepId, 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: stepId,
    gate_adapter: {
      npm_script: stepId.replace(/^lane-/, 'lane:').replaceAll('-', ':'),
      ci_job: null,
    },
    status,
    failure_class: status === 'passed' ? 'none' : 'product_regression',
    stage: 'verify',
    line_kind: 'release_campaign_step',
    evidence_dir: join(campaignRoot, stepId),
    summary: `${stepId} ${status}.`,
    generated_at: GENERATED_AT,
  });
}

function releaseDeployCheckSnapshot(
  campaignRoot: string,
  overrides: Partial<Record<string, 'passed' | 'failed' | 'not_available' | 'unknown'>> = {},
): Record<string, unknown> {
  const steps = [
    ['lane-unified-deploy-substrate', 'dependencies', 'substrate'],
    ['lane-unified-deploy-local-kind-images', 'images', 'local-kind-images'],
    ['lane-unified-deploy-local-kind', 'rollout', 'local-kind'],
    ['lane-unified-deploy-product-flows', 'product flows', 'product-flows'],
  ] as const;
  return {
    schema: 'agentsmith_release_deploy_check_snapshot/v1',
    generated_at: GENERATED_AT,
    items: steps.map(([id, label, evidenceSegment]) => ({
      id,
      label,
      status: overrides[id] ?? 'passed',
      evidence_path: join(campaignRoot, 'unified-deploy', evidenceSegment),
      result_path: join(campaignRoot, id, 'result.json'),
      result_digest: null,
    })),
  };
}

function expectCleanReleaseStatusSummary(rendered: string): void {
  expect(rendered).not.toMatch(/\bGoal:/);
  expect(rendered).not.toMatch(/\bPhase:/);
  expect(rendered).not.toMatch(/\bAuthority:/);
  expect(rendered).not.toMatch(/\bCampaign:/);
  expect(rendered).not.toContain('Automated release verdict');
  expect(rendered).not.toMatch(/\b(?:gate|lane)-[a-z0-9-]+\b/);
  expect(rendered).not.toMatch(/\bnpm run (?:gate|lane|backend-real|test):[a-z0-9:_-]+/);
}

function lease(overrides: Partial<GovernanceRuntimeLockLease>): GovernanceRuntimeLockLease {
  return {
    leaseId: overrides.leaseId ?? 'lease-000001',
    lockId: overrides.lockId ?? 'release-campaign-root-writes',
    scopeKind: overrides.scopeKind ?? 'campaign_root',
    scopeKey: overrides.scopeKey ?? '/tmp/release-run',
    ownerGroup: overrides.ownerGroup ?? 'release-full|run-lease-001|/tmp/release-run',
    ownerAttemptId: overrides.ownerAttemptId ?? 'attempt-lease-001',
    ownerStepId: overrides.ownerStepId ?? 'gate-release',
    mode: overrides.mode ?? 'exclusive',
    campaignId: overrides.campaignId ?? 'release-full',
    runId: overrides.runId ?? 'run-lease-001',
    campaignRoot: overrides.campaignRoot ?? '/tmp/release-run',
    acquiredAt: overrides.acquiredAt ?? GENERATED_AT,
  };
}

function withTempRoot<T>(action: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-status-projection-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectNoReleaseVerdictFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('release_verdict');
  expect(serialized).not.toContain('automated_release_verdict');
}

function expectNoSensitiveProjectionLeak(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const fragment of SENSITIVE_PROJECTION_FRAGMENTS) {
    expect(serialized).not.toContain(fragment);
  }
  expect(serialized).not.toContain('Bearer projection-bearer-raw-token');
}

function expectNoInternalVerifyAlias(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toContain('npm run verify:');
}

function expectNoForbiddenVerifyGoal(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toMatch(/\bnpm run verify -- --goal=(?:debug|release-real) --run\b/);
}

function expectNoPublicAdapterTerm(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toMatch(/\badapter\b/i);
}

describe('current status projection', () => {
  it('renders clean command failures with the canonical blocker-only shape', () => {
    const rendered = renderShortFailureProjection({
      title: 'AgentSmith Product Readiness',
      verdict: 'FAILED',
      blocker: 'environment_conflict',
      stage: 'preflight',
      why: 'port 27027 is owned by agentsmith-unified-substrate-mongodb-1',
      fixCommand: 'npx tsx scripts/unified-deploy/substrate-lifecycle.ts down',
      rerunCommand: 'npm run release:ready',
      evidencePath: 'artifacts/release-runs/run-001/preflight/evidence.json',
    });

    expect(rendered).toBe([
      'Blocker: environment_conflict',
      'Stage: preflight',
      'Why: port 27027 is owned by agentsmith-unified-substrate-mongodb-1',
      'Fix: npx tsx scripts/unified-deploy/substrate-lifecycle.ts down',
      'Rerun: npm run release:ready',
      'Evidence: artifacts/release-runs/run-001/preflight/evidence.json',
      '',
    ].join('\n'));
    expect(rendered).not.toContain('AgentSmith Product Readiness');
    expect(rendered).not.toContain('Verdict:');
  });

  it('renders diagnostic verify reruns as public entrypoints without internal adapter wording', () => {
    const debugRendered = renderShortFailureProjection({
      blocker: 'verify_alias_failed',
      stage: 'verify',
      why: 'internal fast verification adapter failed.',
      rerunCommand: 'npm run verify -- --goal=debug --run',
      evidencePath: 'artifacts/verification/run-001',
    });
    const releaseRealRendered = renderShortFailureProjection({
      blocker: 'verify_alias_failed',
      stage: 'verify',
      why: 'internal release-real verification adapter failed.',
      rerunCommand: 'npm run verify -- --goal=release-real --run',
      evidencePath: 'artifacts/verification/run-002',
    });

    expect(debugRendered).toContain('Rerun: npm run verify -- --goal=pr --run');
    expect(releaseRealRendered).toContain('Rerun: npm run release:ready');
    expect(debugRendered).toContain('Why: internal fast verification check step failed.');
    expect(releaseRealRendered).toContain('Why: internal release-real verification check step failed.');
    expectNoForbiddenVerifyGoal(debugRendered);
    expectNoForbiddenVerifyGoal(releaseRealRendered);
    expectNoPublicAdapterTerm(debugRendered);
    expectNoPublicAdapterTerm(releaseRealRendered);
  });

  it('renders release-ready status rerun as release:ready instead of an owner diagnostic command', () => {
    withTempRoot((campaignRoot) => {
      const aggregatePath = writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'aggregate',
        summary: 'Campaign step lane-unified-deploy-product-flows did not pass.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjection(projection);

      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(rendered).toContain('Blocker: lane-unified-deploy-product-flows');
      expect(rendered).toContain('Stage: aggregate');
      expect(rendered).toContain('Why: Campaign step lane-unified-deploy-product-flows did not pass.');
      expect(rendered).toContain(`Inspect: ${aggregatePath}`);
      expect(rendered).toContain('Rerun: npm run release:ready');
      expect(rendered).toContain(`Evidence: ${aggregatePath}`);
      expect(rendered).not.toContain('npm run lane:unified-deploy:product-flows');
    });
  });

  it('renders the release status summary without making benign raw-log warnings the blocker', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'aggregate',
        summary: 'Campaign step gate-release did not pass.',
      });
      writeReleaseSummaryWithObservability(campaignRoot);

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjectionSummary(projection);

      expect(rendered).toContain('AgentSmith Product Readiness Status');
      expect(rendered).toContain('Status: failed');
      expect(rendered).toContain('Blocker: Backend-real check');
      expect(rendered).toContain('Why: Backend-real check did not pass.');
      expect(rendered).toContain(`Evidence: ${campaignRoot}`);
      expect(rendered).toContain('Rerun: npm run release:ready');
      expect(rendered).toContain('Transition-only deploy diagnostics / 过渡期专项诊断 (not part of AgentSmith product readiness required evidence):');
      expect(rendered).toContain('- dependencies: passed');
      expect(rendered).toContain('- images: passed');
      expect(rendered).toContain('- rollout: passed');
      expect(rendered).toContain('- product flows: passed');
      expect(rendered).toContain('common setup warnings (NO_COLOR, already-existing Postgres resources, containerd deprecations) are diagnostic');
      expect(rendered).not.toContain('Blocker: NO_COLOR');
      expect(rendered).not.toContain('Blocker: Postgres already exists');
      expect(rendered).not.toContain('Blocker: containerd deprecation');
      expect(rendered).not.toContain('Resume recommendation:');
      expect(rendered).not.toContain('Commands executed:');
      expectCleanReleaseStatusSummary(rendered);
    });
  });

  it('projects release duration, slow stages, parent counts, and report size as read-only status', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot);
      writeReleaseSummaryWithObservability(campaignRoot);

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjectionSummary(projection);

      expect(projection.run_observability).toMatchObject({
        total_duration_ms: 5_432_100,
        counts_source: 'parent_flow',
        counts: {
          real_service_start_count: 1,
          api_web_start_count: 1,
          backend_real_check_session_count: 2,
          image_import_count: 3,
        },
        poll_retry_coverage: 'not_covered',
        report_size_bytes: 987_654,
      });
      expect(projection.run_observability?.top_slow_stages.map((stage) => stage.id)).toEqual([
        'gate-release',
        'lane-visual',
        'lane-unified-deploy-product-flows',
      ]);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expect(rendered).toContain('Total duration: 1h 30m 32s');
      expect(rendered).toContain('Slowest steps: Backend real release check 46m 5s; Full visual check 16m 51s; Transition-only deploy diagnostic product flows 2m 45s');
      expect(rendered).not.toContain('Slowest stages: gate-release');
      expect(rendered).toContain('Transition-only deploy diagnostics / 过渡期专项诊断 (not part of AgentSmith product readiness required evidence):');
      expect(rendered).toContain('- dependencies: passed');
      expect(rendered).toContain('- images: passed');
      expect(rendered).toContain('- rollout: passed');
      expect(rendered).toContain('- product flows: passed');
      expect(rendered).toContain('Real service starts: 1');
      expect(rendered).toContain('API/Web starts: 1');
      expect(rendered).toContain('Backend real sessions: 2');
      expect(rendered).toContain('Image imports: 3');
      expect(rendered).toContain('Poll/retry coverage: not covered');
      expect(rendered).not.toContain('Poll/retry attempts: 0');
      expect(rendered).toContain('Report size: 987654 bytes');
      expect(rendered).toContain('Read-only: release:status does not rerun checks or revalidate evidence.');
      expectCleanReleaseStatusSummary(rendered);
    });
  });

  it('renders deploy check from the release summary snapshot instead of mutable step result files', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot);
      writeReleaseSummaryWithObservability(campaignRoot);
      writeDeployStepResult(campaignRoot, 'lane-unified-deploy-product-flows', 'failed');

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjectionSummary(projection);

      expect(rendered).toContain('Transition-only deploy diagnostics / 过渡期专项诊断 (not part of AgentSmith product readiness required evidence):');
      expect(rendered).toContain('- product flows: passed');
      expect(rendered).not.toContain('- product flows: failed');
    });
  });

  it('accepts v1 status projections that omit additive run observability', () => {
    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
    });
    const {
      run_observability: _additive,
      ...legacyProjection
    } = projection;

    expect(legacyProjection).not.toHaveProperty('run_observability');
    expect(validateCurrentStatusProjection(legacyProjection)).toEqual({
      ok: true,
      value: legacyProjection,
    });
  });

  it('includes the read-only lease status shadow in projection JSON without producing decisions or commands', () => {
    const leaseStatusShadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({}),
        lease({
          leaseId: 'lease-destructive',
          lockId: 'destructive-lifecycle',
          scopeKind: 'local_host',
          scopeKey: 'localhost',
          ownerStepId: 'local-real-reset',
        }),
        lease({
          leaseId: 'lease-ports',
          lockId: 'fixed-local-ports',
          scopeKind: 'local_host',
          scopeKey: 'local-real:ports',
          ownerStepId: 'local-real-up',
        }),
        lease({
          leaseId: 'lease-secret',
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: 'backend-real-managed-secret',
          ownerStepId: 'gate-release',
        }),
      ],
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY'],
      env: {
        PRESET_ENDPOINT_API_KEY: 'sk-status-projection-do-not-print',
      },
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });

    expect(projection).toMatchObject({
      schema: CURRENT_STATUS_PROJECTION_SCHEMA,
      version: CURRENT_STATUS_PROJECTION_VERSION,
      projection_kind: 'read_only',
      lease_status_shadow: {
        schema: 'agentsmith_lease_status_shadow/v1',
        projection_kind: 'read_only_shadow',
        leases_acquired: false,
        leases_released: false,
        active_run: {
          run_id: 'run-lease-001',
          campaign_id: 'release-full',
        },
        destructive_command_lock: {
          present: true,
          lock_id: 'destructive-lifecycle',
        },
        port_family: {
          present: true,
          lock_id: 'fixed-local-ports',
        },
        secret_profile_lock: {
          present: true,
          lock_id: 'provider-secret-profile',
          profile: {
            present: true,
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        },
      },
      release_decision_produced: false,
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
    expect(JSON.stringify(projection)).not.toContain('sk-status-projection-do-not-print');
    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expectNoReleaseVerdictFields(projection);
  });

  it('renders lease shadow state and safe action on the first status screen', () => {
    const leaseStatusShadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({}),
        lease({
          leaseId: 'lease-destructive',
          lockId: 'destructive-lifecycle',
          scopeKind: 'local_host',
          scopeKey: 'localhost',
          ownerStepId: 'local-real-reset',
        }),
        lease({
          leaseId: 'lease-ports',
          lockId: 'fixed-local-ports',
          scopeKind: 'local_host',
          scopeKey: 'local-real:ports',
          ownerStepId: 'local-real-up',
        }),
        lease({
          leaseId: 'lease-secret',
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: 'backend-real-managed-secret',
          ownerStepId: 'gate-release',
        }),
      ],
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY'],
      env: {
        PRESET_ENDPOINT_API_KEY: 'sk-status-render-do-not-print',
      },
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });
    const rendered = renderStatusProjection(projection);

    expect(rendered).toContain('Lease shadow active run: run-lease-001');
    expect(rendered).toContain('Lease shadow destructive command lock: present');
    expect(rendered).toContain('destructive-lifecycle');
    expect(rendered).toContain('Lease shadow port family: present');
    expect(rendered).toContain('fixed-local-ports');
    expect(rendered).toContain('Lease shadow secret profile: present');
    expect(rendered).toContain('profile_presence=true');
    expect(rendered).toContain('digest=sha256:');
    expect(rendered).toContain('Next action: npm run release:ready');
    expect(rendered).toContain('Safe action: npm run release:ready');
    expect(rendered).toContain('Release decision produced: false');
    expect(rendered).toContain('Commands executed: false');
    expect(rendered).not.toContain('sk-status-render-do-not-print');
  });

  it('renders legacy diagnostic safe-next commands as public entrypoints', () => {
    const base = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
    });
    const debugProjection = {
      ...base,
      goal: 'verify' as const,
      safe_next_command: 'npm run verify -- --goal=debug --run',
      resume_recommendation: {
        ...base.resume_recommendation,
        safe_next_command: 'npm run verify -- --goal=debug --run',
      },
    };
    const releaseRealProjection = {
      ...base,
      goal: 'verify' as const,
      safe_next_command: 'npm run verify -- --goal=release-real --run',
      resume_recommendation: {
        ...base.resume_recommendation,
        safe_next_command: 'npm run verify -- --goal=release-real --run',
      },
    };

    const debugRendered = renderStatusProjection(debugProjection);
    const releaseRealRendered = renderStatusProjection(releaseRealProjection);

    expect(debugRendered).toContain('Next action: npm run verify -- --goal=pr --run');
    expect(debugRendered).toContain('safe_next=npm run verify -- --goal=pr --run');
    expect(releaseRealRendered).toContain('Next action: npm run release:ready');
    expect(releaseRealRendered).toContain('safe_next=npm run release:ready');
    expectNoForbiddenVerifyGoal(debugRendered);
    expectNoForbiddenVerifyGoal(releaseRealRendered);
    expectNoInternalVerifyAlias(debugRendered);
    expectNoInternalVerifyAlias(releaseRealRendered);
  });

  it('keeps prebuilt shadow scope_kind and mode redacted in projection JSON, lock_owner, and human output', () => {
    const prebuilt = buildMinimalLeaseStatusShadow({
      activeLeases: [lease({})],
      requiredSecretNames: [],
      generatedAt: GENERATED_AT,
    });
    const leaseStatusShadow = resolveMinimalLeaseStatusShadow({
      snapshotJson: JSON.stringify({
        ...prebuilt,
        active_run: prebuilt.active_run
          ? {
              ...prebuilt.active_run,
              owner_group: `owner-${PREBUILT_OWNER_SECRET}`,
              owner_step_id: `step-${PREBUILT_TICKET_SECRET}`,
            }
          : null,
        active_leases: prebuilt.active_leases.map((owner) => ({
          ...owner,
          scope_kind: PREBUILT_SCOPE_KIND_SECRET,
          mode: PREBUILT_MODE_SECRET,
          owner_group: `owner-${PREBUILT_OWNER_SECRET}`,
          owner_attempt_id: `attempt-${PREBUILT_TICKET_SECRET}`,
          owner_step_id: `step-${PREBUILT_OWNER_SECRET}`,
        })),
      }),
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });
    const rendered = renderStatusProjection(projection);
    const serialized = JSON.stringify(projection);

    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expect(projection.lease_status_shadow?.active_leases[0]?.scope_kind).toContain('[redacted]');
    expect(projection.lease_status_shadow?.active_leases[0]?.mode).toContain('[redacted]');
    expect(projection.lock_owner?.owners[0]?.scope_kind).toContain('[redacted]');
    expect(serialized).toContain('[redacted]');
    expect(rendered).toContain('[redacted]');
    for (const raw of [
      PREBUILT_SCOPE_KIND_SECRET,
      PREBUILT_MODE_SECRET,
      PREBUILT_OWNER_SECRET,
      PREBUILT_TICKET_SECRET,
    ]) {
      expect(serialized).not.toContain(raw);
      expect(rendered).not.toContain(raw);
    }
  });

  it('keeps the status projection builder read-only and outside lock acquisition/release paths', () => {
    const source = readFileSync('scripts/governance/status-projection.ts', 'utf8');

    expect(source).not.toMatch(/new GovernanceLockLeaseManager/);
    expect(source).not.toMatch(/\.acquire\s*\(/);
    expect(source).not.toMatch(/\.release(?:Many)?\s*\(/);
  });

  it('projects a passed release status as read-only presentation without producing a release verdict', () => {
    withTempRoot((campaignRoot) => {
      const aggregatePath = writeAggregateResult(campaignRoot);
      const aggregateContent = readFileSync(aggregatePath, 'utf8');

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection).toMatchObject({
        schema: CURRENT_STATUS_PROJECTION_SCHEMA,
        version: CURRENT_STATUS_PROJECTION_VERSION,
        projection_kind: 'read_only',
        goal: 'release-ready',
        runtime_line: null,
        phase: 'aggregate',
        presentation_status: 'passed',
        primary_blocker: null,
        deepest_reason: {
          code: 'none',
          source_path: aggregatePath,
        },
        aggregate_status_ref: {
          path: aggregatePath,
          digest: sha256(aggregateContent),
          gate_id: 'gate-release-full',
          line_kind: 'release_full_verdict',
        },
        release_decision_produced: false,
        commands_executed: false,
        leases_acquired: false,
        leases_released: false,
      });
      expect(projection.aggregate_status_ref).not.toHaveProperty('status');
      expect(projection.aggregate_status_ref).not.toHaveProperty('failure_class');
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('keeps secret-looking artifact paths schema-valid and openable while redacting summaries', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-status-projection-api_key=path-secret-'));
    try {
      const aggregatePath = writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.aggregate_status_ref?.path).toBe(aggregatePath);
      expect(projection.deepest_reason?.source_path).toBe(aggregatePath);
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(projection.evidence_paths.map((entry) => entry.path)).toContain(aggregatePath);
      expect(existsSync(projection.aggregate_status_ref?.path ?? '')).toBe(true);
      expect(projection.aggregate_status_ref?.path.replaceAll('\\', '/')).toMatch(/\/gate-release-full\/result\.json$/);
      expect(projection.deepest_reason?.summary).toContain('[redacted]');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('keeps goal and runtime_line separate and maps local-real to the registered local-manual runtime line', () => {
    const projection = buildStatusProjection({
      goal: 'local-real',
      runtimeLine: 'local-real',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
    });

    expect(projection.goal).toBe('local-real');
    expect(projection.runtime_line).toBe('local-manual');
    expect(projection.aggregate_status_ref).toBe(null);
    expect(projection.authority_paths.aggregate).toBe(null);
    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expectNoReleaseVerdictFields(projection);
  });

  it('only references the release-full aggregate result even when sibling gate results exist', () => {
    withTempRoot((campaignRoot) => {
      writeJson(join(campaignRoot, 'gate-release', 'result.json'), {
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        gate_id: 'gate-release',
        status: 'passed',
        failure_class: 'none',
        stage: 'verify',
        line_kind: 'release_backend_real',
        evidence_dir: join(campaignRoot, 'gate-release'),
        summary: 'Sibling result must not become aggregate_status_ref.',
        generated_at: GENERATED_AT,
      });
      const aggregatePath = writeAggregateResult(campaignRoot);

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.aggregate_status_ref?.path).toBe(aggregatePath);
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(JSON.stringify(projection)).not.toContain('gate-release/result.json');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('classifies stale, running, blocked, and evidence-missing fixtures for first-screen status', () => {
    withTempRoot((staleRoot) => withTempRoot((blockedRoot) => withTempRoot((runningRoot) => {
      writeAggregateResult(staleRoot, { status: 'passed', failure_class: 'none' });
      const stale = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: staleRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: STALE_EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      expect(stale.presentation_status).toBe('stale');
      expect(stale.deepest_reason?.code).toBe('stale_evidence_git_sha');

      writeAggregateResult(blockedRoot, {
        status: 'failed',
        failure_class: 'evidence_missing',
        stage: 'aggregate',
        summary: 'Missing campaign step result: lane-visual',
      });
      const blocked = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: blockedRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      expect(blocked.presentation_status).toBe('failed');
      expect(blocked.primary_blocker).toMatchObject({
        owner: 'lane-visual',
        stage: 'aggregate',
      });
      expect(blocked.deepest_reason).toMatchObject({
        code: 'evidence_missing',
        summary: 'Missing campaign step result: lane-visual',
      });
      expect(blocked.safe_next_command).toBe('npm run release:ready');
      expect(blocked.resume_recommendation.safe_next_command).toBe('npm run release:ready');
      expectNoInternalVerifyAlias(blocked);

      const running = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: runningRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        runId: 'release-run-001',
        startedAt: '2026-04-27T11:59:00.000Z',
        generatedAt: GENERATED_AT,
      });
      expect(running.presentation_status).toBe('running');
      expect(running.phase).toBe('verify');
      expect(running.aggregate_status_ref).toBe(null);
      expect(running.run_age_seconds).toBe(60);

      for (const projection of [stale, blocked, running]) {
        expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
        expectNoReleaseVerdictFields(projection);
      }
    })));
  });

  it('uses the public release-ready wrapper as the gate-release safe next action', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker?.owner).toBe('gate-release');
      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(projection.safe_next_command).not.toBe('npm run verify:release-real');
      expect(JSON.stringify(projection)).not.toContain('npm run verify -- --goal=release-real --run');
      expect(JSON.stringify(projection)).not.toContain('npm run verify:release-real');
    });
  });

  it('adds a read-only resume recommendation from campaign step results without rerunning or skipping', () => {
    withTempRoot((campaignRoot) => {
      const stepResultPath = join(campaignRoot, 'gate-default', 'result.json');
      writeJson(stepResultPath, {
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        gate_id: 'gate-default',
        gate_adapter: {
          npm_script: 'gate:default',
          ci_job: null,
        },
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'execute',
        line_kind: 'release_campaign_default',
        evidence_dir: join(campaignRoot, 'gate-default'),
        summary: 'Release campaign step gate-default failed with exit code 6.',
        generated_at: GENERATED_AT,
      });
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-default did not pass.',
      });
      const stepResultContent = readFileSync(stepResultPath, 'utf8');

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.resume_recommendation).toEqual({
        projection_kind: 'read_only',
        source: 'campaign_step_results',
        action: 'rerun_required',
        owner_job_id: 'gate-default',
        owner_gate_id: 'gate-default',
        producer_job_ids: ['gate-default'],
        downstream_aggregate_job_id: 'gate-release-full',
        step_result_pointer: {
          path: stepResultPath,
          digest: sha256(stepResultContent),
        },
        safe_next_command: 'npm run release:ready',
        reason_codes: ['campaign_step_failed'],
        automatic_rerun: false,
        automatic_skip: false,
      });
      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expect(JSON.stringify(projection)).not.toMatch(/claim_id|reusable|release_verdict|automated_release_verdict/);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('does not let an old failed campaign step result override a passed terminal aggregate recommendation', () => {
    withTempRoot((campaignRoot) => {
      writeFailedCampaignStepResult(campaignRoot);
      writeAggregateResult(campaignRoot, {
        status: 'passed',
        failure_class: 'none',
        summary: 'Release-full campaign evidence passed aggregate verification.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('passed');
      expect(projection.safe_next_command).toBe(null);
      expect(projection.resume_recommendation).toEqual({
        projection_kind: 'read_only',
        source: 'terminal_aggregate',
        action: 'none',
        owner_job_id: null,
        owner_gate_id: null,
        producer_job_ids: [],
        downstream_aggregate_job_id: 'gate-release-full',
        step_result_pointer: null,
        safe_next_command: null,
        reason_codes: ['terminal_aggregate_passed'],
        automatic_rerun: false,
        automatic_skip: false,
      });
      expect(projection.resume_recommendation).not.toMatchObject({
        source: 'campaign_step_results',
        action: 'rerun_required',
      });
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expect(JSON.stringify(projection)).not.toMatch(/claim_id|reusable|release_verdict|automated_release_verdict/);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('does not let old campaign step results override stale terminal aggregate authority', () => {
    withTempRoot((campaignRoot) => {
      writeFailedCampaignStepResult(campaignRoot);
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-default did not pass.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: STALE_EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('stale');
      expect(projection.deepest_reason?.code).toBe('stale_evidence_git_sha');
      expect(projection.resume_recommendation).toMatchObject({
        projection_kind: 'read_only',
        source: 'terminal_aggregate',
        action: 'inspect_authority',
        step_result_pointer: null,
        automatic_rerun: false,
        automatic_skip: false,
      });
      expect(projection.resume_recommendation.reason_codes).toContain('stale_evidence_git_sha');
      expect(projection.resume_recommendation.reason_codes).not.toContain('campaign_step_failed');
      expect(projection.resume_recommendation).not.toMatchObject({
        source: 'campaign_step_results',
        action: 'rerun_required',
      });
      expect(projection.resume_recommendation.safe_next_command).toBe(projection.safe_next_command);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expect(JSON.stringify(projection)).not.toMatch(/claim_id|reusable|release_verdict|automated_release_verdict/);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('does not use stale step advice when terminal aggregate owns a different blocker', () => {
    withTempRoot((campaignRoot) => {
      writeFailedCampaignStepResult(campaignRoot, 'gate-default');
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'evidence_missing',
        summary: 'Missing campaign step result: lane-visual',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker).toMatchObject({
        owner: 'lane-visual',
      });
      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(projection.resume_recommendation).toEqual({
        projection_kind: 'read_only',
        source: 'terminal_aggregate',
        action: 'inspect_authority',
        owner_job_id: 'lane-visual',
        owner_gate_id: 'lane-visual',
        producer_job_ids: ['lane-visual'],
        downstream_aggregate_job_id: 'gate-release-full',
        step_result_pointer: null,
        safe_next_command: 'npm run release:ready',
        reason_codes: ['terminal_aggregate_failed'],
        automatic_rerun: false,
        automatic_skip: false,
      });
      expect(projection.resume_recommendation).not.toMatchObject({
        source: 'campaign_step_results',
        owner_job_id: 'gate-default',
      });
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expect(JSON.stringify(projection)).not.toMatch(/claim_id|reusable|release_verdict|automated_release_verdict/);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it.each([
    ['lane-visual'],
    ['gate-fast'],
    ['gate-default'],
    ['gate-release'],
  ])('uses release:ready as the public next action for failed release owner %s', (owner) => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'evidence_missing',
        summary: `Missing campaign step result: ${owner}`,
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjection(projection);

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker?.owner).toBe(owner);
      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(projection.resume_recommendation.safe_next_command).toBe('npm run release:ready');
      expect(rendered).toContain('Next action: npm run release:ready');
      expect(rendered).not.toContain('Next action: npm run verify');
      expect(rendered).toContain('Diagnostic context:');
      expect(rendered).not.toContain('Resume recommendation:');
      expectNoInternalVerifyAlias(projection);
      expectNoInternalVerifyAlias(rendered);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    });
  });

  it('redacts sensitive aggregate summaries at the status projection boundary', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker?.owner).toBe('gate-release');
      expect(projection.deepest_reason?.summary).toContain('[redacted]');
      expectNoSensitiveProjectionLeak(projection);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('redacts deepest reason summary again when rendering exported status projections', () => {
    const projection = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      deepest_reason: {
        code: 'renderer_secret_regression',
        summary: [
          'Authorization: Bearer renderer-bearer-raw-token',
          'managed_credentials: {"feishu":"renderer-managed-credential-raw-value"}',
          'password: {"value":"renderer-password-raw-value"}',
        ].join(' '),
        source_path: null,
      },
    };

    const rendered = renderStatusProjection(projection);

    expect(rendered).toContain('[redacted]');
    expect(rendered).not.toContain('renderer-bearer-raw-token');
    expect(rendered).not.toContain('renderer-managed-credential-raw-value');
    expect(rendered).not.toContain('renderer-password-raw-value');
    expect(rendered).not.toContain('Authorization: Bearer renderer-bearer-raw-token');
  });

  it('fails closed when aggregate status is passed but failure_class is not none', () => {
    withTempRoot((campaignRoot) => {
      const aggregatePath = writeAggregateResult(campaignRoot, {
        status: 'passed',
        failure_class: 'product_regression',
        summary: 'Corrupt aggregate says passed with product regression.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).not.toBe('passed');
      expect(projection.presentation_status).toBe('unknown');
      expect(projection.aggregate_status_ref).toBe(null);
      expect(projection.deepest_reason).toMatchObject({
        code: 'aggregate_result_inconsistent',
        source_path: aggregatePath,
      });
      expect(projection.deepest_reason?.summary).toContain('passed result must use failure_class none');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    });
  });

  it('fails closed when aggregate status or failure_class is outside the current gate schema enum', () => {
    withTempRoot((badStatusRoot) => withTempRoot((badFailureClassRoot) => {
      const badStatusPath = writeAggregateResult(badStatusRoot, {
        status: 'green',
        failure_class: 'none',
        summary: 'Corrupt aggregate uses an unknown status.',
      });
      const badStatus = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: badStatusRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(badStatus.presentation_status).toBe('unknown');
      expect(badStatus.aggregate_status_ref).toBe(null);
      expect(badStatus.deepest_reason).toMatchObject({
        code: 'aggregate_result_invalid_status',
        source_path: badStatusPath,
      });
      expect(badStatus.deepest_reason?.summary).toContain('current gate result status');

      const badFailureClassPath = writeAggregateResult(badFailureClassRoot, {
        status: 'failed',
        failure_class: 'flaky',
        summary: 'Corrupt aggregate uses an unknown failure class.',
      });
      const badFailureClass = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: badFailureClassRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(badFailureClass.presentation_status).toBe('unknown');
      expect(badFailureClass.aggregate_status_ref).toBe(null);
      expect(badFailureClass.deepest_reason).toMatchObject({
        code: 'aggregate_result_invalid_failure_class',
        source_path: badFailureClassPath,
      });
      expect(badFailureClass.deepest_reason?.summary).toContain('current gate result failure class');

      for (const projection of [badStatus, badFailureClass]) {
        expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
        expectNoReleaseVerdictFields(projection);
      }
    }));
  });

  it('fails schema validation for verdict pollution and non-aggregate status references', () => {
    const polluted = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      release_verdict: 'PASSED',
    };

    expect(validateCurrentStatusProjection(polluted)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'projection.release_verdict' }),
      ]),
    });

    const badAggregate = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      aggregate_status_ref: {
        path: 'artifacts/release-runs/run-001/gate-release/result.json',
        digest: `sha256:${'1'.repeat(64)}`,
        gate_id: 'gate-release',
        line_kind: 'release_backend_real',
      },
    };

    expect(validateCurrentStatusProjection(badAggregate)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'projection.aggregate_status_ref.gate_id' }),
        expect.objectContaining({ path: 'projection.aggregate_status_ref.line_kind' }),
      ]),
    });
  });

  it('supports release-status --json as a read-only projection without changing release-summary truth', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as unknown;

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expectNoReleaseVerdictFields(projection);
      expect(existsSync(join(campaignRoot, 'summary.json'))).toBe(false);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('keeps release-status --json next action on release:ready for failed owner diagnostics', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as {
        safe_next_command?: unknown;
        primary_blocker?: { owner?: unknown };
        resume_recommendation?: { safe_next_command?: unknown };
      };

      expect(projection.primary_blocker?.owner).toBe('gate-release');
      expect(projection.safe_next_command).toBe('npm run release:ready');
      expect(projection.resume_recommendation?.safe_next_command).toBe('npm run release:ready');
      expect(output).not.toContain('npm run verify -- --goal=release-real --run');
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
    });
  });

  it('does not run checks when rendering release-status', () => {
    withTempRoot((campaignRoot) => withTempRoot((fakeBinRoot) => {
      writeAggregateResult(campaignRoot);
      writeReleaseSummaryWithObservability(campaignRoot);
      const logPath = join(fakeBinRoot, 'npm.log');
      writeFileSync(join(fakeBinRoot, 'npm'), [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$*" >> "${logPath}"`,
        'exit 99',
        '',
      ].join('\n'));
      chmodSync(join(fakeBinRoot, 'npm'), 0o755);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBinRoot}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(output).toContain('Read-only: release:status does not rerun checks or revalidate evidence.');
      expect(existsSync(logPath)).toBe(false);
    }));
  });

  it('keeps release-status --json from replaying redacted terminal summary secrets', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
      });

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as unknown;

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expectNoReleaseVerdictFields(projection);
      expectNoSensitiveProjectionLeak(output);
    });
  });
});
