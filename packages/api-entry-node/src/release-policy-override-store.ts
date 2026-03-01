import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'release_policy_overrides';

export type ReleasePolicyOverrideReasonCategory =
  | 'upstream_transient'
  | 'known_acceptable_risk'
  | 'rollout_exception'
  | 'governance_window';

export type ReleasePolicyOverrideRecord = {
  id: string;
  incident_id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'runtime' | 'usage';
  issue_message: string;
  reason_category: ReleasePolicyOverrideReasonCategory;
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

export function getReleasePolicyOverrideEffectiveStatus(
  record: ReleasePolicyOverrideRecord,
  nowIso = new Date().toISOString(),
): 'pending' | 'approved' | 'rejected' | 'expired' {
  if (record.status !== 'approved') return record.status;
  return record.expires_at.localeCompare(nowIso) < 0 ? 'expired' : 'approved';
}

export async function listReleasePolicyOverrides(
  docStore: JsonDocStorePort,
  params: {
    workspaceId: string;
    projectId: string;
    reportName: string;
  },
): Promise<ReleasePolicyOverrideRecord[]> {
  const items = await docStore.list<ReleasePolicyOverrideRecord>(COLLECTION, {
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
  });
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createReleasePolicyOverride(
  docStore: JsonDocStorePort,
  params: {
    workspaceId: string;
    projectId: string;
    reportName: string;
    incidentId: string;
    issueId: string;
    issueSource: 'execution' | 'runtime' | 'usage';
    issueMessage: string;
    reasonCategory: ReleasePolicyOverrideReasonCategory;
    reason: string;
    expiresAt: string;
    createdByUserId: string;
    createdByName?: string;
  },
): Promise<ReleasePolicyOverrideRecord> {
  const now = new Date().toISOString();
  const existing = await docStore.list<ReleasePolicyOverrideRecord>(COLLECTION, {
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
    issue_id: params.issueId,
  });
  if (existing[0]) {
    return existing[0];
  }

  const record: ReleasePolicyOverrideRecord = {
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

export async function updateReleasePolicyOverrideDecision(
  docStore: JsonDocStorePort,
  params: {
    overrideId: string;
    status: 'approved' | 'rejected';
    decidedByUserId: string;
    decidedByName?: string;
  },
): Promise<ReleasePolicyOverrideRecord | null> {
  const existing = await docStore.get<ReleasePolicyOverrideRecord>(COLLECTION, params.overrideId);
  if (!existing) return null;
  const next: ReleasePolicyOverrideRecord = {
    ...existing,
    status: params.status,
    decided_at: new Date().toISOString(),
    decided_by_user_id: params.decidedByUserId,
    decided_by_name: params.decidedByName,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}
