import type { NodeApiDeps } from '../node-api-deps.js';
import { listGovernanceIncidents } from '../governance-incident-store.js';
import { listGovernanceIncidentStates } from '../governance-incident-state-store.js';
import { getGovernancePolicyOverrideEffectiveStatus, listGovernancePolicyOverrides } from '../governance-policy-override-store.js';
import {
  enforceGovernance,
  evaluateGovernance,
  mergeGovernanceEvaluations,
  type GovernanceEvaluation,
} from '../governance-evaluation.js';

type GovernanceReportPolicyShape = {
  summary?: {
    governance_policy?: GovernanceEvaluation;
  };
};

export async function buildPolicyEnforcement(
  deps: NodeApiDeps,
  reportName: string,
  report: Record<string, unknown>,
  scope?: { workspaceId?: string | null; projectId?: string | null },
) {
  const baseEvaluation = (report as GovernanceReportPolicyShape).summary?.governance_policy;
  if (!baseEvaluation) return undefined;
  const workspaceId = scope?.workspaceId?.trim();
  const projectId = scope?.projectId?.trim();
  const overrides = workspaceId && projectId
    ? await listGovernancePolicyOverrides(deps.docStore, { workspaceId, projectId, reportName })
    : [];
  const escalations = listGovernanceIncidents(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents')
    .filter((item) => item.report_name === reportName);
  const escalationStates = await listGovernanceIncidentStates(deps.docStore);
  const escalationStateById = new Map(escalationStates.map((item) => [item.id, item]));
  const mergedEscalations = escalations.map((item) => mergeEscalationState(item, escalationStateById.get(item.id)));
  const governanceEvaluation = mergedEscalations.length > 0
    ? evaluateGovernance({
      governance: {
        open_escalations: mergedEscalations.filter((item) => item.status !== 'resolved').length,
        critical_unassigned: mergedEscalations.filter((item) =>
          item.status !== 'resolved' && item.severity === 'critical' && !(item.assignee_user_id ?? '').trim()).length,
        critical_overdue: mergedEscalations.filter((item) =>
          item.status !== 'resolved' && item.severity === 'critical' && item.sla_status === 'overdue').length,
        due_soon: mergedEscalations.filter((item) =>
          item.status !== 'resolved' && item.sla_status === 'due_soon').length,
      },
    })
    : undefined;
  const evaluation = mergeGovernanceEvaluations(baseEvaluation, governanceEvaluation);
  return enforceGovernance(
    evaluation,
    overrides.map((item) => {
      const effectiveStatus = getGovernancePolicyOverrideEffectiveStatus(item);
      return {
        issue_id: item.issue_id,
        status: effectiveStatus === 'expired' ? 'rejected' : effectiveStatus,
      };
    }),
  );
}

export function mergeEscalationState<T extends {
    status: 'open' | 'resolved';
    acknowledged_at?: string;
    acknowledged_by_user_id?: string;
    acknowledged_by_name?: string;
    assignee_user_id?: string;
    assignee_name?: string;
    due_at?: string;
    resolution_reason?: string;
    resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    resolved_at?: string;
    resolved_by_user_id?: string;
    resolved_by_name?: string;
  } & Record<string, unknown>>(
  event: T,
  state?: {
    acknowledged_at?: string;
    acknowledged_by_user_id?: string;
    acknowledged_by_name?: string;
    assignee_user_id?: string;
    assignee_name?: string;
    due_at?: string;
    resolution_status?: 'open' | 'resolved';
    resolution_reason?: string;
    resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    resolved_at?: string;
    resolved_by_user_id?: string;
    resolved_by_name?: string;
  } | null,
): T & {
  status: 'open' | 'resolved';
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  assignee_user_id?: string;
  assignee_name?: string;
  due_at?: string;
  resolution_reason?: string;
  resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  age_ms?: number;
  sla_status: 'on_track' | 'due_soon' | 'overdue' | 'resolved';
} {
  const status = state?.resolution_status ?? event.status;
  const dueAt = state?.due_at ?? event.due_at;
  const now = Date.now();
  const dueTime = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  const ageMs = typeof event.created_at === 'string' ? now - new Date(event.created_at).getTime() : undefined;
  let slaStatus: 'on_track' | 'due_soon' | 'overdue' | 'resolved' = 'on_track';
  if (status === 'resolved') {
    slaStatus = 'resolved';
  } else if (!Number.isNaN(dueTime)) {
    const remainingMs = dueTime - now;
    if (remainingMs < 0) slaStatus = 'overdue';
    else if (remainingMs <= 4 * 60 * 60 * 1000) slaStatus = 'due_soon';
  }
  return {
    ...event,
    status,
    acknowledged_at: state?.acknowledged_at ?? event.acknowledged_at,
    acknowledged_by_user_id: state?.acknowledged_by_user_id ?? event.acknowledged_by_user_id,
    acknowledged_by_name: state?.acknowledged_by_name ?? event.acknowledged_by_name,
    assignee_user_id: state?.assignee_user_id ?? event.assignee_user_id,
    assignee_name: state?.assignee_name ?? event.assignee_name,
    due_at: dueAt,
    resolution_reason: state?.resolution_reason ?? event.resolution_reason,
    resolution_category: state?.resolution_category ?? event.resolution_category,
    resolved_at: state?.resolved_at ?? event.resolved_at,
    resolved_by_user_id: state?.resolved_by_user_id ?? event.resolved_by_user_id,
    resolved_by_name: state?.resolved_by_name ?? event.resolved_by_name,
    age_ms: Number.isNaN(ageMs) ? undefined : ageMs,
    sla_status: slaStatus,
  };
}

export function withOverrideEffectiveStatus<T extends { status: 'pending' | 'approved' | 'rejected'; expires_at: string }>(
  record: T,
): T & { effective_status: 'pending' | 'approved' | 'rejected' | 'expired' } {
  const effectiveStatus = record.status === 'approved' && record.expires_at.localeCompare(new Date().toISOString()) < 0
    ? 'expired'
    : record.status;
  return {
    ...record,
    effective_status: effectiveStatus,
  };
}
