import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { findCurrentVerificationCampaignById } from '../current-verification-campaign-manifest';
import {
  evaluateTerminalAggregateOutcome,
  writeTerminalAggregateFallbackResult,
} from '../release-campaign-runner';

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

function writeFakeNpm(dir: string, script: string): string {
  const path = join(dir, 'npm');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

function runReleaseCampaignWithFakeNpm(root: string, fakeBin: string): void {
  try {
    execFileSync('npx', ['tsx', 'scripts/governance/run-current-verification-campaign.ts', 'release-full'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
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
      expect(defaultGateScript).toContain('run_cmd "npm run contracts:check"');
      expect(defaultGateScript).toContain('run_cmd "npx tsc --noEmit"');
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
});
