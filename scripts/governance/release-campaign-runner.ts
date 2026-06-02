import type { SpawnSyncReturns } from 'node:child_process';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
} from './current-gate-result-schema';
import type { CurrentVerificationCampaignStep } from './current-verification-campaign-manifest';
import {
  resultPath,
  tryReadGateResult,
  writeCampaignEvidencePointer,
  writeCampaignGateResult,
} from './release-campaign-io';

export interface ReleaseCampaignSpawnResult {
  status: SpawnSyncReturns<unknown>['status'];
  signal: SpawnSyncReturns<unknown>['signal'];
  error?: Error;
  timedOut?: boolean;
  timeoutMs?: number;
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

export interface TerminalAggregateResultReadiness {
  ok: boolean;
  status?: string;
  failureClass?: string;
  error?: string;
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
  if (aggregateResult.timedOut && aggregateResult.timeoutMs !== undefined) {
    details.push(`timeout_ms=${String(aggregateResult.timeoutMs)}`);
  }
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

  if (hadExecutableStepFailure && aggregateResult.status === 0) {
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

export function terminalAggregateResultIsReadable(input: {
  campaignRoot: string;
  terminalStep: CurrentVerificationCampaignStep;
}): TerminalAggregateResultReadiness {
  const path = resultPath(input.campaignRoot, input.terminalStep);
  const result = tryReadGateResult(path);
  if (!result.ok || !result.value) {
    return {
      ok: false,
      error: result.error ?? `missing terminal result: ${path}`,
    };
  }

  const value = result.value;
  if (value.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `terminal result schema_version must be ${CURRENT_GATE_RESULT_SCHEMA_VERSION}`,
    };
  }
  if (value.gate_id !== input.terminalStep.gateId) {
    return {
      ok: false,
      error: `terminal result gate_id must be ${input.terminalStep.gateId}`,
    };
  }
  if (value.line_kind !== input.terminalStep.lineKind) {
    return {
      ok: false,
      error: `terminal result line_kind must be ${input.terminalStep.lineKind}`,
    };
  }
  if (
    typeof value.status !== 'string'
    || !CURRENT_GATE_RESULT_STATUSES.includes(value.status as never)
  ) {
    return {
      ok: false,
      error: 'terminal result status is invalid',
    };
  }
  if (
    typeof value.failure_class !== 'string'
    || !CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(value.failure_class as never)
  ) {
    return {
      ok: false,
      error: 'terminal result failure_class is invalid',
    };
  }
  if (typeof value.stage !== 'string' || typeof value.summary !== 'string') {
    return {
      ok: false,
      error: 'terminal result stage and summary must be strings',
    };
  }

  return {
    ok: true,
    status: value.status,
    failureClass: value.failure_class,
  };
}

export function writeTerminalAggregateFallbackResult(input: {
  campaignRoot: string;
  terminalStep: CurrentVerificationCampaignStep;
  outcome: TerminalAggregateOutcome;
}): boolean {
  const readable = terminalAggregateResultIsReadable({
    campaignRoot: input.campaignRoot,
    terminalStep: input.terminalStep,
  });
  const hasReadableFailureVerdict = readable.ok && readable.status === 'failed';
  const shouldWriteFallback = input.outcome.shouldWriteFallbackResult
    || (input.outcome.exitCode !== 0 && !hasReadableFailureVerdict);

  if (!shouldWriteFallback) {
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
