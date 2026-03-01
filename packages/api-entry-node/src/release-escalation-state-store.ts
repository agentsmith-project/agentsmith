import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'release_escalation_states';

export type ReleaseEscalationStateRecord = {
  id: string;
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  resolution_status?: 'open' | 'resolved';
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  resolution_reason?: string;
  updated_at: string;
};

export async function listReleaseEscalationStates(
  docStore: JsonDocStorePort,
): Promise<ReleaseEscalationStateRecord[]> {
  const items = await docStore.list<ReleaseEscalationStateRecord>(COLLECTION);
  return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getReleaseEscalationState(
  docStore: JsonDocStorePort,
  escalationId: string,
): Promise<ReleaseEscalationStateRecord | null> {
  return docStore.get<ReleaseEscalationStateRecord>(COLLECTION, escalationId);
}

export async function acknowledgeReleaseEscalation(
  docStore: JsonDocStorePort,
  params: {
    escalationId: string;
    userId: string;
    userName?: string;
  },
): Promise<ReleaseEscalationStateRecord> {
  const existing = await getReleaseEscalationState(docStore, params.escalationId);
  const now = new Date().toISOString();
  const next: ReleaseEscalationStateRecord = {
    id: params.escalationId,
    acknowledged_at: now,
    acknowledged_by_user_id: params.userId,
    acknowledged_by_name: params.userName,
    resolution_status: existing?.resolution_status,
    resolved_at: existing?.resolved_at,
    resolved_by_user_id: existing?.resolved_by_user_id,
    resolved_by_name: existing?.resolved_by_name,
    resolution_reason: existing?.resolution_reason,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}

export async function setReleaseEscalationResolution(
  docStore: JsonDocStorePort,
  params: {
    escalationId: string;
    status: 'open' | 'resolved';
    reason?: string;
    userId: string;
    userName?: string;
  },
): Promise<ReleaseEscalationStateRecord> {
  const existing = await getReleaseEscalationState(docStore, params.escalationId);
  const now = new Date().toISOString();
  const next: ReleaseEscalationStateRecord = {
    id: params.escalationId,
    acknowledged_at: existing?.acknowledged_at,
    acknowledged_by_user_id: existing?.acknowledged_by_user_id,
    acknowledged_by_name: existing?.acknowledged_by_name,
    resolution_status: params.status,
    resolved_at: params.status === 'resolved' ? now : undefined,
    resolved_by_user_id: params.status === 'resolved' ? params.userId : undefined,
    resolved_by_name: params.status === 'resolved' ? params.userName : undefined,
    resolution_reason: params.reason?.trim() || undefined,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, next.id, next);
  return next;
}
