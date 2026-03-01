import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'release_policy_overrides';

export type ReleasePolicyOverrideRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'runtime' | 'usage';
  issue_message: string;
  reason: string;
  created_at: string;
  created_by_user_id: string;
  created_by_name?: string;
};

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
    issueId: string;
    issueSource: 'execution' | 'runtime' | 'usage';
    issueMessage: string;
    reason: string;
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
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    report_name: params.reportName,
    issue_id: params.issueId,
    issue_source: params.issueSource,
    issue_message: params.issueMessage,
    reason: params.reason,
    created_at: now,
    created_by_user_id: params.createdByUserId,
    created_by_name: params.createdByName,
  };
  await docStore.upsert(COLLECTION, record.id, record);
  return record;
}
