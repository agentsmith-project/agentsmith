import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'governance_policy_overrides';

export type GovernancePolicyOverrideReasonCategory =
  | 'upstream_transient'
  | 'known_acceptable_risk'
  | 'approved_exception'
  | 'governance_window';

export type GovernancePolicyOverrideRecord = {
  id: string;
  incident_id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'configuration' | 'usage';
  issue_message: string;
  reason_category: GovernancePolicyOverrideReasonCategory;
  reason: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  created_by_user_id: string;
  created_by_name?: string;
  decided_at?: string;
  decided_by_user_id?: string;
  decided_by_name?: string;
};

export function getGovernancePolicyOverrideEffectiveStatus(
  record: GovernancePolicyOverrideRecord,
  nowIso = new Date().toISOString(),
): 'pending' | 'approved' | 'rejected' | 'expired' {
  if (record.status !== 'approved') return record.status;
  return record.expires_at.localeCompare(nowIso) < 0 ? 'expired' : 'approved';
}

export async function listGovernancePolicyOverrides(
  docStore: JsonDocStorePort,
  params: {
    workspaceId: string;
    projectId: string;
    reportName: string;
  },
): Promise<GovernancePolicyOverrideRecord[]> {
  const items = await docStore.list<GovernancePolicyOverrideRecord>(COLLECTION, {
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
  });
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createGovernancePolicyOverride(
  docStore: JsonDocStorePort,
  params: {
    workspaceId: string;
    projectId: string;
    reportName: string;
    incidentId: string;
    issueId: string;
    issueSource: 'execution' | 'configuration' | 'usage';
    issueMessage: string;
    reasonCategory: GovernancePolicyOverrideReasonCategory;
    reason: string;
    expiresAt: string;
    createdByUserId: string;
    createdByName?: string;
  },
): Promise<GovernancePolicyOverrideRecord> {
  const now = new Date().toISOString();
  const existing = await docStore.list<GovernancePolicyOverrideRecord>(COLLECTION, {
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
    issue_id: params.issueId,
  });
  if (existing[0]) {
    return existing[0];
  }

  const record: GovernancePolicyOverrideRecord = {
    id: `rpo_${randomUUID()}`,
    incident_id: params.incidentId,
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
    issue_id: params.issueId,
    issue_source: params.issueSource,
    issue_message: params.issueMessage,
    reason_category: params.reasonCategory,
    reason: params.reason,
    expires_at: params.expiresAt,
    status: 'pending',
    created_at: now,
    created_by_user_id: params.createdByUserId,
    created_by_name: params.createdByName,
  };
  await docStore.upsert(COLLECTION, record.id, record);
  return record;
}

export async function updateGovernancePolicyOverrideDecision(
  docStore: JsonDocStorePort,
  params: {
    overrideId: string;
    status: 'approved' | 'rejected';
    decidedByUserId: string;
    decidedByName?: string;
  },
): Promise<GovernancePolicyOverrideRecord | null> {
  const existing = await docStore.get<GovernancePolicyOverrideRecord>(COLLECTION, params.overrideId);
  if (!existing) return null;
  const next: GovernancePolicyOverrideRecord = {
    ...existing,
    status: params.status,
    decided_at: new Date().toISOString(),
    decided_by_user_id: params.decidedByUserId,
    decided_by_name: params.decidedByName,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}
