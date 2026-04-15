import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
