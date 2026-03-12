import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'governance_incident_states';

export type GovernanceIncidentStateRecord = {
  id: string;
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  assignee_user_id?: string;
  assignee_name?: string;
  due_at?: string;
  resolution_status?: 'open' | 'resolved';
  resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  resolution_reason?: string;
  updated_at: string;
};

export async function listGovernanceIncidentStates(
  docStore: JsonDocStorePort,
): Promise<GovernanceIncidentStateRecord[]> {
  const items = await docStore.list<GovernanceIncidentStateRecord>(COLLECTION);
  return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getGovernanceIncidentState(
  docStore: JsonDocStorePort,
  escalationId: string,
): Promise<GovernanceIncidentStateRecord | null> {
  return docStore.get<GovernanceIncidentStateRecord>(COLLECTION, escalationId);
}

export async function acknowledgeGovernanceIncident(
  docStore: JsonDocStorePort,
  params: {
    escalationId: string;
    userId: string;
    userName?: string;
  },
): Promise<GovernanceIncidentStateRecord> {
  const existing = await getGovernanceIncidentState(docStore, params.escalationId);
  const now = new Date().toISOString();
  const next: GovernanceIncidentStateRecord = {
    id: params.escalationId,
    acknowledged_at: now,
    acknowledged_by_user_id: params.userId,
    acknowledged_by_name: params.userName,
    assignee_user_id: existing?.assignee_user_id,
    assignee_name: existing?.assignee_name,
    due_at: existing?.due_at,
    resolution_status: existing?.resolution_status,
    resolution_category: existing?.resolution_category,
    resolved_at: existing?.resolved_at,
    resolved_by_user_id: existing?.resolved_by_user_id,
    resolved_by_name: existing?.resolved_by_name,
    resolution_reason: existing?.resolution_reason,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}

export async function setGovernanceIncidentResolution(
  docStore: JsonDocStorePort,
  params: {
    escalationId: string;
    status: 'open' | 'resolved';
    reason?: string;
    category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    userId: string;
    userName?: string;
  },
): Promise<GovernanceIncidentStateRecord> {
  const existing = await getGovernanceIncidentState(docStore, params.escalationId);
  const now = new Date().toISOString();
  const next: GovernanceIncidentStateRecord = {
    id: params.escalationId,
    acknowledged_at: existing?.acknowledged_at,
    acknowledged_by_user_id: existing?.acknowledged_by_user_id,
    acknowledged_by_name: existing?.acknowledged_by_name,
    assignee_user_id: existing?.assignee_user_id,
    assignee_name: existing?.assignee_name,
    due_at: existing?.due_at,
    resolution_status: params.status,
    resolution_category: params.status === 'resolved' ? params.category : undefined,
    resolved_at: params.status === 'resolved' ? now : undefined,
    resolved_by_user_id: params.status === 'resolved' ? params.userId : undefined,
    resolved_by_name: params.status === 'resolved' ? params.userName : undefined,
    resolution_reason: params.reason?.trim() || undefined,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}

export async function assignGovernanceIncident(
  docStore: JsonDocStorePort,
  params: {
    escalationId: string;
    assigneeUserId: string;
    assigneeName?: string;
    dueAt?: string;
  },
): Promise<GovernanceIncidentStateRecord> {
  const existing = await getGovernanceIncidentState(docStore, params.escalationId);
  const now = new Date().toISOString();
  const next: GovernanceIncidentStateRecord = {
    id: params.escalationId,
    acknowledged_at: existing?.acknowledged_at,
    acknowledged_by_user_id: existing?.acknowledged_by_user_id,
    acknowledged_by_name: existing?.acknowledged_by_name,
    assignee_user_id: params.assigneeUserId,
    assignee_name: params.assigneeName,
    due_at: params.dueAt,
    resolution_status: existing?.resolution_status,
    resolution_category: existing?.resolution_category,
    resolved_at: existing?.resolved_at,
    resolved_by_user_id: existing?.resolved_by_user_id,
    resolved_by_name: existing?.resolved_by_name,
    resolution_reason: existing?.resolution_reason,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}
