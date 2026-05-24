import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { findCurrentVerificationCampaignById } from '../current-verification-campaign-manifest';
import {
  evaluateTerminalAggregateOutcome,
  writeTerminalAggregateFallbackResult,
} from '../release-campaign-runner';
import {
  writeCampaignGateResult,
} from '../release-campaign-io';
import {
  buildReleaseCampaignAggregateEnv,
  buildReleaseCampaignCommandEnv,
  buildReleaseCampaignRuntimeLeaseRequests,
  runReleaseCampaignExecution,
} from '../release-campaign-execution';
import {
  readReleaseStatus,
} from '../release-summary';
import {
  RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV,
  validateRunReadinessStateForConsumer,
} from '../run-readiness-state';

function releaseFullTerminalStep() {
  const campaign = findCurrentVerificationCampaignById('release-full');
  const terminalStep = campaign?.steps.find((step) => step.executionMode === 'aggregate_only');
  if (!terminalStep) {
    throw new Error('Missing release-full terminal aggregate step.');
  }
  return terminalStep;
}

function releaseFullExecutableSteps() {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign.');
  }
  return campaign.steps.filter((step) => step.executionMode === 'execute');
}

function releaseFullStep(stepId: string) {
  const campaign = findCurrentVerificationCampaignById('release-full');
  const step = campaign?.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Missing release-full step: ${stepId}`);
  }
  return step;
}

function writeFakeNpm(dir: string, script: string): string {
  const path = join(dir, 'npm');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function runReleaseCampaignWithFakeNpm(
  root: string,
  fakeBin: string,
  extraEnv: NodeJS.ProcessEnv = {},
): void {
  try {
    execFileSync('npx', ['tsx', 'scripts/governance/run-current-verification-campaign.ts', 'release-full'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        RELEASE_CAMPAIGN_ROOT: root,
        RELEASE_CAMPAIGN_RUN_ID: 'release-campaign-runner-test',
      },
      stdio: 'pipe',
    });
  } catch {
    // The fake npm scripts intentionally fail executable steps; assertions inspect
    // the canonical campaign artifacts produced before the terminal verdict exits.
  }
}

describe('release campaign runner lifecycle contract', () => {
  it('projects release campaign runtime leases from the current resource lock semantics', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-locks-'));
    try {
      const campaign = findCurrentVerificationCampaignById('release-full');
      if (!campaign) {
        throw new Error('Missing release-full campaign.');
      }

      const requestsByStep = new Map(campaign.steps.map((step) => [
        step.id,
        buildReleaseCampaignRuntimeLeaseRequests({
          campaignId: campaign.id,
          runId: 'lock-projection-test',
          campaignRoot: root,
          step,
        }),
      ]));

      for (const step of campaign.steps) {
        const requestIds = requestsByStep.get(step.id)?.map((request) => request.lockId) ?? [];
        expect(requestIds, `${step.id} must lease the campaign root`).toContain('release-campaign-root-writes');
        expect(requestIds, `${step.id} must lease its step output`).toContain('release-campaign-step-output');
      }

      const visualLocks = requestsByStep.get('lane-visual') ?? [];
      expect(visualLocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lockId: 'visual-baseline-update',
            scopeKind: 'visual_baseline',
            scopeKey: 'repo:visual-baseline-update',
          }),
        ]),
      );

      const defaultGateFixedPorts = (requestsByStep.get('gate-default') ?? [])
        .find((request) => request.lockId === 'fixed-local-ports');
      const visualFixedPorts = visualLocks.find((request) => request.lockId === 'fixed-local-ports');
      expect(defaultGateFixedPorts, 'gate-default must lease fixed local ports').toBeDefined();
      expect(visualFixedPorts, 'lane-visual must lease fixed local ports').toBeDefined();
      expect(defaultGateFixedPorts?.scopeKind).toBe('local_host');
      expect(visualFixedPorts?.scopeKind).toBe('local_host');
      expect(visualFixedPorts?.scopeKey).toBe(defaultGateFixedPorts?.scopeKey);

      const gateReleaseLockIds = new Set((requestsByStep.get('gate-release') ?? []).map((request) => request.lockId));
      expect([...gateReleaseLockIds]).toEqual(
        expect.arrayContaining([
          'shared-local-substrate',
          'destructive-lifecycle',
          'fixed-local-ports',
          'backend-real-provider-quota',
          'provider-secret-profile',
        ]),
      );

      expect([...requestsByStep.keys()].filter((stepId) => stepId.startsWith('lane-unified-deploy-'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the terminal aggregate verifier is killed by signal', () => {
    const outcome = evaluateTerminalAggregateOutcome({
      terminalStepId: 'gate-release-full',
      hadExecutableStepFailure: false,
      aggregateResult: {
        status: null,
        signal: 'SIGTERM',
      },
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.shouldWriteFallbackResult).toBe(true);
    expect(outcome.failureClass).toBe('infra_setup_failure');
    expect(outcome.summary).toContain('SIGTERM');
  });

  it('fails closed when the terminal aggregate verifier has a spawn error or missing command', () => {
    const missingCommand = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
    const outcome = evaluateTerminalAggregateOutcome({
      terminalStepId: 'gate-release-full',
      hadExecutableStepFailure: false,
      aggregateResult: {
        status: null,
        signal: null,
        error: missingCommand,
      },
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.shouldWriteFallbackResult).toBe(true);
    expect(outcome.failureClass).toBe('infra_setup_failure');
    expect(outcome.summary).toMatch(/ENOENT|spawn npm/);
  });

  it('does not return green when executable campaign steps already failed', () => {
    const outcome = evaluateTerminalAggregateOutcome({
      terminalStepId: 'gate-release-full',
      hadExecutableStepFailure: true,
      aggregateResult: {
        status: 0,
        signal: null,
      },
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.shouldWriteFallbackResult).toBe(true);
    expect(outcome.failureClass).toBe('product_regression');
    expect(outcome.summary).toContain('executable release campaign step failed');
  });

  it('does not overwrite a normally failed terminal aggregate verdict with runner fallback', () => {
    const outcome = evaluateTerminalAggregateOutcome({
      terminalStepId: 'gate-release-full',
      hadExecutableStepFailure: true,
      aggregateResult: {
        status: 1,
        signal: null,
      },
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.shouldWriteFallbackResult).toBe(false);
    expect(outcome.failureClass).toBe('product_regression');
    expect(outcome.summary).toContain('failed with exit code 1');
  });

  it('writes fallback terminal result when aggregate exits nonzero without producing a terminal artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-terminal-fallback-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  exit 1
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const terminalPath = join(root, 'gate-release-full', 'result.json');
      expect(existsSync(terminalPath)).toBe(true);
      const terminal = JSON.parse(readFileSync(terminalPath, 'utf8')) as {
        status: string;
        failure_class: string;
        summary: string;
      };
      expect(terminal.status).toBe('failed');
      expect(terminal.failure_class).toBe('product_regression');
      expect(terminal.summary).toContain('failed with exit code 1');
      expect(existsSync(join(root, 'gate-release-full', 'evidence.json'))).toBe(true);

      const status = readReleaseStatus({ campaignRoot: root });
      expect(status.kind).toBe('ready');
      if (status.kind === 'ready') {
        expect(status.summary.automated_release_verdict).toBe('FAILED');
        expect(status.summary.terminal_result_path).toBe(terminalPath);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('overwrites stale passed terminal artifact when aggregate exits nonzero', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-stale-terminal-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    try {
      const terminalStep = releaseFullTerminalStep();
      writeCampaignGateResult({
        step: terminalStep,
        campaignRoot: root,
        status: 'passed',
        failureClass: 'none',
        stage: 'complete',
        summary: 'Stale terminal aggregate result from a prior run passed.',
      });
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  exit 1
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const terminalPath = join(root, 'gate-release-full', 'result.json');
      const terminal = JSON.parse(readFileSync(terminalPath, 'utf8')) as {
        status: string;
        failure_class: string;
        summary: string;
      };
      expect(terminal.status).toBe('failed');
      expect(terminal.failure_class).toBe('product_regression');
      expect(terminal.summary).toContain('failed with exit code 1');
      expect(existsSync(join(root, 'gate-release-full', 'evidence.json'))).toBe(true);

      const status = readReleaseStatus({ campaignRoot: root });
      expect(status.kind).toBe('ready');
      if (status.kind === 'ready') {
        expect(status.summary.automated_release_verdict).toBe('FAILED');
        expect(status.summary.failure_class).toBe('product_regression');
        expect(status.summary.terminal_result_path).toBe(terminalPath);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('only exits green when executable steps passed and aggregate status is zero', () => {
    const outcome = evaluateTerminalAggregateOutcome({
      terminalStepId: 'gate-release-full',
      hadExecutableStepFailure: false,
      aggregateResult: {
        status: 0,
        signal: null,
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.shouldWriteFallbackResult).toBe(false);
    expect(outcome.summary).toContain('passed');
  });

  it('writes failed terminal evidence for abnormal aggregate termination', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-'));
    try {
      const terminalStep = releaseFullTerminalStep();
      const outcome = evaluateTerminalAggregateOutcome({
        terminalStepId: terminalStep.id,
        hadExecutableStepFailure: false,
        aggregateResult: {
          status: null,
          signal: 'SIGKILL',
        },
      });

      writeTerminalAggregateFallbackResult({
        campaignRoot: root,
        terminalStep,
        outcome,
      });

      const resultPath = join(root, 'gate-release-full', 'result.json');
      const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
        status: string;
        failure_class: string;
        summary: string;
      };
      expect(result.status).toBe('failed');
      expect(result.failure_class).toBe('infra_setup_failure');
      expect(result.summary).toContain('SIGKILL');

      const evidencePath = join(root, 'gate-release-full', 'evidence.json');
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
        schema_version: string;
        step_id: string;
        gate_id: string;
        evidence_dir: string;
        native_result: unknown;
        required_paths: readonly { id: string; exists: boolean }[];
      };
      expect(evidence.step_id).toBe('gate-release-full');
      expect(evidence.gate_id).toBe('gate-release-full');
      expect(evidence.evidence_dir).toBe(join(root, 'gate-release-full'));
      expect(evidence.native_result).toBeNull();
      expect(evidence.required_paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'campaign_root',
            exists: true,
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the campaign-after-gate-fast profile for gate-default without mutating standalone preflight', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-profile-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|profile=%s\\n' "$*" "\${DEFAULT_GATE_PROFILE:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:fast" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "gate:default" ]]; then
  [[ "\${DEFAULT_GATE_PROFILE:-}" == "campaign_after_gate_fast" ]]
  exit 7
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('run gate:fast|profile=');
      expect(log).toContain('run gate:default|profile=campaign_after_gate_fast');

      const defaultGateScript = readFileSync('scripts/default-gate.sh', 'utf8');
      expect(defaultGateScript).toContain('DEFAULT_GATE_PROFILE');
      expect(defaultGateScript).toContain('campaign_after_gate_fast');
      expect(defaultGateScript).toContain('run_pure_check_cmd "contracts" "npm run contracts:check"');
      expect(defaultGateScript).toContain('run_pure_check_cmd "lint" "npm run lint"');
      expect(defaultGateScript).toContain('next_generated_root_run_locked_type_state_gate_sequence');
      expect(defaultGateScript).toContain('run_cmd "npx next typegen ."');
      expect(defaultGateScript).toContain('run_pure_check_cmd "typecheck" "npx tsc --noEmit"');
      expect(defaultGateScript).toContain('run_cmd "npm run build"');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('keeps release campaign step env equivalent to the old internal runner adapters', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-env-'));
    try {
      const runId = 'release-env-equivalence-test';
      const baseEnvWithParentOnlyWriter = {
        [RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]: 'writer-parent-only-secret',
      };

      const gateDefault = buildReleaseCampaignCommandEnv({
        campaignRoot: root,
        runId,
        step: releaseFullStep('gate-default'),
        baseEnv: baseEnvWithParentOnlyWriter,
      });
      expect(gateDefault.DEFAULT_GATE_PROFILE).toBe('campaign_after_gate_fast');
      expect(gateDefault.DEFAULT_GATE_REUSE_FAST_EVIDENCE).toBe('1');
      expect(gateDefault.UNIFIED_DEPLOY_RELEASE_ROOT_DIR).toBe(join(root, 'unified-deploy'));
      expect(gateDefault.UNIFIED_DEPLOY_RELEASE_SITE_ENV).toBe(join(root, 'unified-deploy', 'local-kind-site.env'));
      expect(gateDefault[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]).toBeUndefined();

      const visual = buildReleaseCampaignCommandEnv({
        campaignRoot: root,
        runId,
        step: releaseFullStep('lane-visual'),
        baseEnv: baseEnvWithParentOnlyWriter,
      });
      expect(visual.MOCK_RUN_ID).toBe(runId);
      expect(visual.VISUAL_BASELINE_REVIEW_ROOT).toBe(join(root, 'lane-visual', 'visual-baseline-reviews'));
      expect(visual.CURRENT_GATE_RESULT_GATE_ID).toBe('lane-visual');
      expect(visual.CURRENT_GATE_RESULT_NPM_SCRIPT).toBe('lane:visual');
      expect(visual.CURRENT_GATE_RESULT_LINE_KIND).toBe('visual');
      expect(visual.CURRENT_GATE_RESULT_EVIDENCE_DIR).toBe(join(root, 'lane-visual', 'native'));
      expect(visual[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]).toBeUndefined();

      const release = buildReleaseCampaignCommandEnv({
        campaignRoot: root,
        runId,
        step: releaseFullStep('gate-release'),
        baseEnv: baseEnvWithParentOnlyWriter,
      });
      expect(release.BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE).toBe('1');
      expect(release.RELEASE_REAL_VISUAL_RUN_ID).toBe(runId);
      expect(release.RELEASE_REAL_VISUAL_ARTIFACT_DIR).toBe(join(root, 'gate-release', 'backend-real-visual'));
      expect(release.RELEASE_REAL_RUN_ROOT).toBe(join(root, 'gate-release', 'backend-real-run'));
      expect(release.RELEASE_REAL_READY_LOG_DIR).toBe(join(root, 'gate-release', 'native'));
      expect(release.CURRENT_GATE_RESULT_GATE_ID).toBe('lane-backend-real-release');
      expect(release.CURRENT_GATE_RESULT_NPM_SCRIPT).toBe('lane:backend-real:release');
      expect(release.CURRENT_GATE_RESULT_LINE_KIND).toBe('release_backend_real');
      expect(release.CURRENT_GATE_RESULT_EVIDENCE_DIR).toBe(join(root, 'gate-release', 'native'));
      expect(release[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]).toBeUndefined();

      expect(releaseFullExecutableSteps().map((step) => step.id).filter((id) => id.startsWith('lane-unified-deploy-'))).toEqual([]);

      const aggregate = buildReleaseCampaignAggregateEnv({
        campaignRoot: root,
        runId,
        baseEnv: {
          ...baseEnvWithParentOnlyWriter,
          CURRENT_GATE_RESULT_GATE_ID: 'stale-parent-gate',
        },
      });
      expect(aggregate.RELEASE_CAMPAIGN_RUN_ID).toBe(runId);
      expect(aggregate.RELEASE_CAMPAIGN_ROOT).toBe(root);
      expect(aggregate[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('scrubs stale step-specific result env from terminal aggregate while preserving executable step env', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-terminal-env-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|gate=%s|script=%s|mock=%s|visual=%s|release_real=%s|unified=%s|reuse=%s|smoke_skip=%s\\n' \\
  "$*" \\
  "\${CURRENT_GATE_RESULT_GATE_ID:-}" \\
  "\${CURRENT_GATE_RESULT_NPM_SCRIPT:-}" \\
  "\${MOCK_RUN_ID:-}" \\
  "\${VISUAL_BASELINE_REVIEW_ROOT:-}" \\
  "\${RELEASE_REAL_RUN_ROOT:-}" \\
  "\${UNIFIED_DEPLOY_RELEASE_ROOT_DIR:-}" \\
  "\${BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE:-}" \\
  "\${AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:fast" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "gate:default" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "lane:visual" ]]; then
  exit 8
fi
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  exit 1
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin, {
        CURRENT_GATE_RESULT_GATE_ID: 'stale-parent-gate',
        CURRENT_GATE_RESULT_NPM_SCRIPT: 'stale:script',
        CURRENT_GATE_RESULT_LINE_KIND: 'stale_line_kind',
        CURRENT_GATE_RESULT_EVIDENCE_DIR: '/tmp/stale-evidence',
        MOCK_RUN_ID: 'stale-mock-run',
        VISUAL_BASELINE_REVIEW_ROOT: '/tmp/stale-visual-review',
        RELEASE_REAL_RUN_ROOT: '/tmp/stale-release-real',
        UNIFIED_DEPLOY_RELEASE_ROOT_DIR: '/tmp/stale-unified-deploy',
        BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE: 'stale-backend-reuse',
        AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT: 'stale-smoke-skip',
      });

      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain(
        `run lane:visual|gate=lane-visual|script=lane:visual|mock=release-campaign-runner-test|visual=${join(root, 'lane-visual', 'visual-baseline-reviews')}`,
      );

      const terminalLine = log.split('\n').find((line) => line.startsWith('run gate:release:full|'));
      expect(terminalLine).toBeDefined();
      expect(terminalLine).not.toContain('stale-parent-gate');
      expect(terminalLine).not.toContain('stale:script');
      expect(terminalLine).not.toContain('stale-mock-run');
      expect(terminalLine).not.toContain('stale-visual-review');
      expect(terminalLine).not.toContain('stale-release-real');
      expect(terminalLine).not.toContain('stale-unified-deploy');
      expect(terminalLine).not.toContain('stale-backend-reuse');
      expect(terminalLine).not.toContain('stale-smoke-skip');
      expect(terminalLine).toBe('run gate:release:full|gate=|script=|mock=|visual=|release_real=|unified=|reuse=|smoke_skip=');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('creates release campaign readiness state and propagates its identity to child adapters', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-readiness-state-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|state=%s|invocation=%s|nonce=%s|input=%s|env_digest=%s\\n' \\
  "$*" \\
  "\${AGENTSMITH_READINESS_STATE_PATH:-}" \\
  "\${AGENTSMITH_READINESS_INVOCATION_ID:-}" \\
  "\${AGENTSMITH_READINESS_PROCESS_NONCE:-}" \\
  "\${AGENTSMITH_READINESS_INPUT_DIGEST:-}" \\
  "\${AGENTSMITH_READINESS_ENV_DIGEST:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:fast" ]]; then
  exit 5
fi
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  exit 1
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const log = readFileSync(logPath, 'utf8');
      const firstLine = log.split('\n').find((line) => line.startsWith('run gate:fast|'));
      expect(firstLine).toBeDefined();
      expect(firstLine).toContain(`state=${join(root, 'state', 'readiness.json')}`);
      expect(firstLine).toContain('invocation=');
      expect(firstLine).toContain('nonce=');
      expect(firstLine).toContain('input=sha256:');
      expect(firstLine).toContain('env_digest=sha256:');
      expect(log).toContain(`run gate:release:full|state=${join(root, 'state', 'readiness.json')}`);

      const parts = Object.fromEntries(
        firstLine!
          .split('|')
          .slice(1)
          .map((pair) => pair.split(/=(.*)/, 2) as [string, string]),
      );
      expect(validateRunReadinessStateForConsumer({
        statePath: parts.state,
        invocationId: parts.invocation,
        processNonce: parts.nonce,
        inputDigest: parts.input,
        envDigest: parts.env_digest,
      })).toMatchObject({ ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('marks local-kind image import readiness with the same site-env identity consumed by rollout', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-local-kind-readiness-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    try {
      const siteEnv = [
        'AGENTSMITH_APP_IMAGE=kind-registry:5000/mbos/agentsmith-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'AGENTSMITH_MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '',
      ].join('\n');
      mkdirSync(join(root, 'unified-deploy'), { recursive: true });
      writeFileSync(join(root, 'unified-deploy', 'local-kind-site.env'), siteEnv);
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
exit 0
`);
      writeFileSync(join(fakeBin, 'kubectl'), [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [[ "$1" == "config" && "$2" == "current-context" ]]; then',
        '  printf "kind-agentsmith\\n"',
        '  exit 0',
        'fi',
        'if [[ "$1" == "get" && "$2" == "namespace" && "$3" == "kube-system" ]]; then',
        '  printf "cluster-uid-campaign-local-kind\\n"',
        '  exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n'));
      chmodSync(join(fakeBin, 'kubectl'), 0o755);
      const result = runReleaseCampaignExecution({
        campaign: {
          id: 'release-full',
          description: 'minimal local-kind readiness identity campaign',
          runRootPattern: '<tmp>',
          steps: [
            {
              id: 'lane-unified-deploy-local-kind-images',
              gateId: 'lane-unified-deploy-local-kind-images',
              npmScript: 'lane:unified-deploy:local-kind:images',
              command: 'npm run lane:unified-deploy:local-kind:images',
              workflowRole: 'evidence_owner',
              executionMode: 'execute',
              resultRequired: false,
              evidenceRequired: false,
              lineKind: 'unified_deploy_local_kind_images',
              defaultFailureClass: 'infra_setup_failure',
              dependsOn: [],
              evidenceHints: [],
              evidenceChecks: [],
            },
            {
              id: 'gate-release-full',
              gateId: 'gate-release-full',
              npmScript: 'gate:release:full',
              command: 'npm run gate:release:full',
              workflowRole: 'terminal_verdict',
              executionMode: 'aggregate_only',
              resultRequired: false,
              evidenceRequired: false,
              lineKind: 'release_full_verdict',
              defaultFailureClass: 'evidence_missing',
              dependsOn: ['lane-unified-deploy-local-kind-images'],
              evidenceHints: [],
              evidenceChecks: [],
            },
          ],
        },
        campaignRoot: root,
        runId: 'release-campaign-local-kind-readiness',
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
        writeSummary: false,
      });

      expect(result.exitCode).toBe(0);
      const statePath = join(root, 'state', 'readiness.json');
      const readiness = JSON.parse(readFileSync(statePath, 'utf8')) as {
        readiness: Record<string, string>;
        readiness_identities: Record<string, { values: Record<string, string> }>;
        invocation_id: string;
        process_nonce: string;
        git_sha: string;
      };
      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: readiness.invocation_id,
        processNonce: readiness.process_nonce,
        gitSha: readiness.git_sha,
      })).toMatchObject({ ok: true });
      expect(readiness.readiness.local_kind_image_import_completed).toBe('ready');
      expect(readiness.readiness_identities.local_kind_image_import_completed.values).toEqual({
        local_kind_context: 'kind-agentsmith',
        local_kind_cluster_uid: 'cluster-uid-campaign-local-kind',
        local_kind_site_env_digest: sha256(siteEnv),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('writes skipped results and evidence pointers for executable steps after an upstream failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-skipped-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:fast" ]]; then
  exit 5
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('run gate:fast');
      expect(log).toContain('run gate:release:full');
      expect(log).not.toContain('run gate:default');
      expect(log).not.toContain('run lane:visual');

      const [, ...downstreamSteps] = releaseFullExecutableSteps();
      for (const step of downstreamSteps) {
        const resultPath = join(root, step.id, 'result.json');
        expect(existsSync(resultPath), `${step.id} skipped result should exist`).toBe(true);
        const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
          status: string;
          failure_class: string;
          stage: string;
          summary: string;
        };
        expect(result.status).toBe('failed');
        expect(result.stage).toBe('skipped');
        expect(result.failure_class).toBe('product_regression');
        expect(result.summary).toContain('gate-fast');

        if (step.evidenceRequired) {
          expect(existsSync(join(root, step.id, 'evidence.json')), `${step.id} skipped evidence pointer should exist`)
            .toBe(true);
        }
      }

      try {
        execFileSync('npx', ['tsx', 'scripts/governance/run-release-full-aggregate.ts'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            RELEASE_CAMPAIGN_ROOT: root,
            RELEASE_CAMPAIGN_RUN_ID: 'release-campaign-runner-test',
          },
          stdio: 'pipe',
        });
      } catch {
        // A skipped campaign is still a failed campaign; this assertion is about
        // preserving skipped evidence so aggregate does not report missing steps.
      }

      const terminalResult = JSON.parse(
        readFileSync(join(root, 'gate-release-full', 'result.json'), 'utf8'),
      ) as { summary: string };
      expect(terminalResult.summary).not.toContain('Missing campaign step result');
      expect(terminalResult.summary).toContain('Campaign step gate-fast did not pass.');
      expect(terminalResult.summary).toContain('Campaign step gate-default did not pass.');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('distinguishes fail-fast skipped siblings from dependency-failed downstream steps', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-campaign-fail-fast-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:fast" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "gate:default" ]]; then
  exit 6
fi
exit 0
`);

      runReleaseCampaignWithFakeNpm(root, fakeBin);

      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('run gate:fast');
      expect(log).toContain('run gate:default');
      expect(log).toContain('run gate:release:full');
      expect(log).not.toContain('run lane:visual');
      expect(log.split('\n')).not.toContain('run gate:release');

      const visualResult = JSON.parse(
        readFileSync(join(root, 'lane-visual', 'result.json'), 'utf8'),
      ) as { status: string; stage: string; summary: string };
      expect(visualResult.status).toBe('failed');
      expect(visualResult.stage).toBe('skipped');
      expect(visualResult.summary).toContain('campaign fail-fast');
      expect(visualResult.summary).toContain('gate-default');
      expect(visualResult.summary).not.toContain('dependency gate-default');

      const releaseResult = JSON.parse(
        readFileSync(join(root, 'gate-release', 'result.json'), 'utf8'),
      ) as { status: string; stage: string; summary: string };
      expect(releaseResult.status).toBe('failed');
      expect(releaseResult.stage).toBe('skipped');
      expect(releaseResult.summary).toContain('dependency gate-default');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
