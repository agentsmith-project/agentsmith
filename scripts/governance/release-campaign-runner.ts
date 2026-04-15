import type { SpawnSyncReturns } from 'node:child_process';

import type { CurrentGateResultFailureClass } from './current-gate-result-schema';
import type { CurrentVerificationCampaignStep } from './current-verification-campaign-manifest';
import {
  writeCampaignEvidencePointer,
  writeCampaignGateResult,
} from './release-campaign-io';

export interface ReleaseCampaignSpawnResult {
  status: SpawnSyncReturns<unknown>['status'];
  signal: SpawnSyncReturns<unknown>['signal'];
  error?: Error;
}

export interface TerminalAggregateOutcome {
  exitCode: number;
  shouldWriteFallbackResult: boolean;
  failureClass: CurrentGateResultFailureClass;
  stage: string;
  summary: string;
}

export interface TerminalAggregateEvaluationInput {
  terminalStepId: string;
  hadExecutableStepFailure: boolean;
  aggregateResult: ReleaseCampaignSpawnResult;
}

function describeSpawnError(error: Error): string {
  const code = (error as { code?: unknown }).code;
  const prefix = typeof code === 'string' && code.length > 0 ? `${code}: ` : '';
  return `${prefix}${error.message || String(error)}`;
}

function abnormalAggregateSummary(
  terminalStepId: string,
  aggregateResult: ReleaseCampaignSpawnResult,
): string {
  const details: string[] = [];
  if (aggregateResult.signal) {
    details.push(`signal ${aggregateResult.signal}`);
  }
  if (aggregateResult.error) {
    details.push(`error ${describeSpawnError(aggregateResult.error)}`);
  }
  if (aggregateResult.status === null && details.length === 0) {
    details.push('status null');
  }

  return `Release campaign terminal aggregate ${terminalStepId} did not complete normally (${details.join('; ')}).`;
}

export function evaluateTerminalAggregateOutcome(
  input: TerminalAggregateEvaluationInput,
): TerminalAggregateOutcome {
  const { aggregateResult, hadExecutableStepFailure, terminalStepId } = input;

  if (aggregateResult.error || aggregateResult.signal || aggregateResult.status === null) {
    return {
      exitCode: 1,
      shouldWriteFallbackResult: true,
      failureClass: 'infra_setup_failure',
      stage: 'execute',
      summary: abnormalAggregateSummary(terminalStepId, aggregateResult),
    };
  }

  if (hadExecutableStepFailure) {
    return {
      exitCode: 1,
      shouldWriteFallbackResult: true,
      failureClass: 'product_regression',
      stage: 'execute',
      summary: `Release campaign terminal aggregate ${terminalStepId} returned 0, but at least one executable release campaign step failed.`,
    };
  }

  if (aggregateResult.status === 0) {
    return {
      exitCode: 0,
      shouldWriteFallbackResult: false,
      failureClass: 'none',
      stage: 'complete',
      summary: `Release campaign terminal aggregate ${terminalStepId} passed.`,
    };
  }

  return {
    exitCode: aggregateResult.status,
    shouldWriteFallbackResult: false,
    failureClass: 'product_regression',
    stage: 'execute',
    summary: `Release campaign terminal aggregate ${terminalStepId} failed with exit code ${String(aggregateResult.status)}.`,
  };
}

export function writeTerminalAggregateFallbackResult(input: {
  campaignRoot: string;
  terminalStep: CurrentVerificationCampaignStep;
  outcome: TerminalAggregateOutcome;
}): boolean {
  if (!input.outcome.shouldWriteFallbackResult) {
    return false;
  }

  writeCampaignGateResult({
    step: input.terminalStep,
    campaignRoot: input.campaignRoot,
    status: 'failed',
    failureClass: input.outcome.failureClass,
    stage: input.outcome.stage,
    summary: input.outcome.summary,
  });
  writeCampaignEvidencePointer(input.campaignRoot, input.terminalStep);
  return true;
}
