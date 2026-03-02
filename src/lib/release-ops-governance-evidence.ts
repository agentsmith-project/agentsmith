import type { GovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { classifyGovernanceEvidenceFocus, type GovernanceEvidenceFocus } from '@/lib/governance-evidence';
import type { RuntimeObservabilityResponse, UsageReportEvidence } from '@/lib/api/endpoints/audit-usage';
import type { ReleaseEscalationEvent, ReleaseGateRunListItem } from '@/lib/api/endpoints/release-ops';

export interface ReleaseOpsGovernanceEvidenceSnapshot {
  focus: GovernanceEvidenceFocus;
  reason: string;
  totalSignals: number;
  blockedSignals: number;
  warningSignals: number;
  metrics: Array<{
    key:
      | 'runtime_terminal_errors'
      | 'runtime_missing_price_facts'
      | 'usage_blockers'
      | 'usage_failed_deliveries_7d'
      | 'usage_unack_required_deliveries'
      | 'release_fail_runs'
      | 'release_fail_runs_focus_filtered'
      | 'open_escalations'
      | 'critical_escalations';
    value: number;
  }>;
  trace: Array<{
    id: string;
    source: 'usage_blocker' | 'usage_warning' | 'escalation';
    severity: 'blocked' | 'warning';
    message: string;
    timestamp?: string;
  }>;
}

function countFocusFailRuns(focus: GovernanceEvidenceFocus, runs: ReleaseGateRunListItem[]): number {
  if (focus === 'other') {
    return runs.filter((item) => item.status === 'fail').length;
  }
  return runs.filter((item) => {
    if (item.status !== 'fail') {
      return false;
    }
    const tokens = `${item.failed_step_name ?? ''} ${item.failed_step_category ?? ''}`.toLowerCase();
    if (focus === 'quota') {
      return tokens.includes('quota') || tokens.includes('rate_limit');
    }
    if (focus === 'cost') {
      return tokens.includes('price') || tokens.includes('cost') || tokens.includes('usage');
    }
    if (focus === 'deny') {
      return tokens.includes('permission') || tokens.includes('authorization');
    }
    return true;
  }).length;
}

export function buildReleaseOpsGovernanceEvidenceSnapshot(args: {
  context: GovernanceDrilldownContext;
  runtime?: RuntimeObservabilityResponse;
  usageEvidence?: UsageReportEvidence;
  runs?: ReleaseGateRunListItem[];
  escalations?: ReleaseEscalationEvent[];
}): ReleaseOpsGovernanceEvidenceSnapshot {
  const focus = classifyGovernanceEvidenceFocus(args.context.gov_reason);
  const blockedSignals = args.context.gov_blocked_signals ?? 0;
  const warningSignals = args.context.gov_warning_signals ?? 0;
  const totalSignals = args.context.gov_related_signals ?? blockedSignals + warningSignals;
  const runs = args.runs ?? [];
  const escalations = args.escalations ?? [];

  return {
    focus,
    reason: args.context.gov_reason ?? '',
    totalSignals,
    blockedSignals,
    warningSignals,
    metrics: [
      { key: 'runtime_terminal_errors', value: args.runtime?.health_summary.terminal_error_requests ?? 0 },
      { key: 'runtime_missing_price_facts', value: args.runtime?.health_summary.missing_price_facts ?? 0 },
      { key: 'usage_blockers', value: args.usageEvidence?.blockers.length ?? 0 },
      { key: 'usage_failed_deliveries_7d', value: args.usageEvidence?.failed_deliveries_last_7d ?? 0 },
      { key: 'usage_unack_required_deliveries', value: args.usageEvidence?.unacknowledged_required_deliveries ?? 0 },
      { key: 'release_fail_runs', value: runs.filter((item) => item.status === 'fail').length },
      { key: 'release_fail_runs_focus_filtered', value: countFocusFailRuns(focus, runs) },
      { key: 'open_escalations', value: escalations.filter((item) => item.status !== 'resolved').length },
      {
        key: 'critical_escalations',
        value: escalations.filter((item) => item.status !== 'resolved' && item.severity === 'critical').length,
      },
    ],
    trace: [
      ...(args.usageEvidence?.blockers ?? []).slice(0, 3).map((item, index) => ({
        id: `usage-blocker-${index}`,
        source: 'usage_blocker' as const,
        severity: 'blocked' as const,
        message: item,
      })),
      ...(args.usageEvidence?.warnings ?? []).slice(0, 3).map((item, index) => ({
        id: `usage-warning-${index}`,
        source: 'usage_warning' as const,
        severity: 'warning' as const,
        message: item,
      })),
      ...escalations
        .filter((item) => item.status !== 'resolved')
        .slice(0, 3)
        .map((item) => ({
          id: `escalation-${item.id}`,
          source: 'escalation' as const,
          severity: item.severity === 'critical' ? 'blocked' as const : 'warning' as const,
          message: item.title,
          timestamp: item.created_at,
        })),
    ],
  };
}
