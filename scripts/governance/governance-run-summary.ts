import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const GOVERNANCE_RUN_SUMMARY_FILE_NAME = 'governance-run-summary.json';

export interface BuildGovernanceRunSummaryInput {
  goal: 'release';
  reportRoot: string;
  planSource: string;
  campaignId: 'release-full';
  campaignRoot: string;
  campaignRunId: string;
  campaignEngineInvoked: boolean;
  campaignExecutionReturned: boolean;
}

export interface GovernanceRunSummary {
  schema: 'agentsmith_governance_run_summary/v1';
  goal: 'release';
  mode: 'run';
  report_root: string;
  plan_source: string;
  campaign_engine_invoked: boolean;
  campaign_execution_returned: boolean;
  evidence_claims_created: false;
  cache_reuse_evaluated: false;
  runner_output_scope: 'audit_only';
  campaign: {
    id: 'release-full';
    root: string;
    run_id: string;
  };
  terminal_aggregate_source: {
    kind: 'release_campaign_terminal_aggregate_result';
    reference_kind: 'campaign_output_path_reference';
    path: string;
    artifact_path_observed: boolean;
  };
  release_summary_source: {
    kind: 'release_campaign_summary';
    reference_kind: 'campaign_output_path_reference';
    path: string;
    artifact_path_observed: boolean;
  };
  generated_at: string;
}

export function buildGovernanceRunSummary(input: BuildGovernanceRunSummaryInput): GovernanceRunSummary {
  const terminalAggregatePath = path.join(input.campaignRoot, 'gate-release-full', 'result.json');
  const releaseSummaryPath = path.join(input.campaignRoot, 'summary.json');
  const terminalAggregatePresent = existsSync(terminalAggregatePath);
  const releaseSummaryPresent = existsSync(releaseSummaryPath);

  return {
    schema: 'agentsmith_governance_run_summary/v1',
    goal: input.goal,
    mode: 'run',
    report_root: input.reportRoot,
    plan_source: input.planSource,
    campaign_engine_invoked: input.campaignEngineInvoked,
    campaign_execution_returned: input.campaignExecutionReturned,
    evidence_claims_created: false,
    cache_reuse_evaluated: false,
    runner_output_scope: 'audit_only',
    campaign: {
      id: input.campaignId,
      root: input.campaignRoot,
      run_id: input.campaignRunId,
    },
    terminal_aggregate_source: {
      kind: 'release_campaign_terminal_aggregate_result',
      reference_kind: 'campaign_output_path_reference',
      path: terminalAggregatePath,
      artifact_path_observed: terminalAggregatePresent,
    },
    release_summary_source: {
      kind: 'release_campaign_summary',
      reference_kind: 'campaign_output_path_reference',
      path: releaseSummaryPath,
      artifact_path_observed: releaseSummaryPresent,
    },
    generated_at: new Date().toISOString(),
  };
}

export function writeGovernanceRunSummary(input: BuildGovernanceRunSummaryInput): string {
  mkdirSync(input.reportRoot, { recursive: true });
  const outputPath = path.join(input.reportRoot, GOVERNANCE_RUN_SUMMARY_FILE_NAME);
  writeFileSync(outputPath, `${JSON.stringify(buildGovernanceRunSummary(input), null, 2)}\n`);
  return outputPath;
}
