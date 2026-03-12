import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

const COLLECTION = 'governance_incident_history';

export type GovernanceIncidentHistoryRecord = {
  id: string;
  incident_id: string;
  escalation_id: string;
  event_kind: 'escalation_assignment';
  created_at: string;
  actor_user_id: string;
  actor_name?: string;
  previous_assignee_user_id?: string;
  previous_assignee_name?: string;
  previous_due_at?: string;
  next_assignee_user_id: string;
  next_assignee_name?: string;
  next_due_at?: string;
};

export async function listGovernanceIncidentHistory(
  docStore: JsonDocStorePort,
  params: {
    incidentId?: string;
    escalationId?: string;
  } = {},
): Promise<GovernanceIncidentHistoryRecord[]> {
  const query: Record<string, string> = {};
  if (params.incidentId) query.incident_id = params.incidentId;
  if (params.escalationId) query.escalation_id = params.escalationId;
  const items = await docStore.list<GovernanceIncidentHistoryRecord>(COLLECTION, Object.keys(query).length > 0 ? query : undefined);
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function recordGovernanceIncidentAssignmentHistory(
  docStore: JsonDocStorePort,
  params: {
    incidentId: string;
    escalationId: string;
    actorUserId: string;
    actorName?: string;
    previousAssigneeUserId?: string;
    previousAssigneeName?: string;
    previousDueAt?: string;
    nextAssigneeUserId: string;
    nextAssigneeName?: string;
    nextDueAt?: string;
  },
): Promise<GovernanceIncidentHistoryRecord> {
  const record: GovernanceIncidentHistoryRecord = {
    id: `rih_${randomUUID()}`,
    incident_id: params.incidentId,
    escalation_id: params.escalationId,
    event_kind: 'escalation_assignment',
    created_at: new Date().toISOString(),
    actor_user_id: params.actorUserId,
    actor_name: params.actorName,
    previous_assignee_user_id: params.previousAssigneeUserId,
    previous_assignee_name: params.previousAssigneeName,
    previous_due_at: params.previousDueAt,
    next_assignee_user_id: params.nextAssigneeUserId,
    next_assignee_name: params.nextAssigneeName,
    next_due_at: params.nextDueAt,
  };
  await docStore.upsert(COLLECTION, record.id, record);
  return record;
}
