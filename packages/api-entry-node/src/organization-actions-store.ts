import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

const STATE_COLLECTION = 'organization_action_states';
const AUDIT_COLLECTION = 'organization_action_audit_events';

export type OrganizationActionStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export type OrganizationActionAuditEventRecord = {
  id: string;
  action_id: string;
  status: OrganizationActionStatus;
  actor_user_id: string;
  actor_name: string;
  note?: string;
  at: string;
};

type OrganizationActionStateRecord = {
  action_id: string;
  status: OrganizationActionStatus;
  updated_at: string;
  history_total: number;
};

export type OrganizationActionServerRecord = {
  action_id: string;
  status: OrganizationActionStatus;
  updated_at: string;
  history_total: number;
  history: OrganizationActionAuditEventRecord[];
};

function normalizeActionStatus(value: string | undefined): OrganizationActionStatus | null {
  if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked') {
    return value;
  }
  return null;
}

export function parseOrganizationActionStatus(value: unknown): OrganizationActionStatus | null {
  return typeof value === 'string' ? normalizeActionStatus(value) : null;
}

export async function listOrganizationActionRecords(
  docStore: JsonDocStorePort,
  options: { actionIds?: string[]; historyLimit?: number } = {},
): Promise<OrganizationActionServerRecord[]> {
  const actionIds = (options.actionIds ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const historyLimit = Math.max(0, Math.min(options.historyLimit ?? 20, 100));
  const items = actionIds.length > 0
    ? await Promise.all(actionIds.map(async (actionId) => {
      const state = await docStore.get<OrganizationActionStateRecord>(STATE_COLLECTION, actionId);
      return state ?? {
        action_id: actionId,
        status: 'pending' as OrganizationActionStatus,
        updated_at: new Date(0).toISOString(),
        history_total: 0,
      };
    }))
    : await docStore.list<OrganizationActionStateRecord>(STATE_COLLECTION);
  const sorted = items.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return Promise.all(
    sorted.map(async (item) => ({
      action_id: item.action_id,
      status: item.status,
      updated_at: item.updated_at,
      history_total: item.history_total,
      history: await listOrganizationActionHistory(docStore, {
        actionId: item.action_id,
        limit: historyLimit,
      }),
    })),
  );
}

export async function listOrganizationActionHistory(
  docStore: JsonDocStorePort,
  options: {
    actionId: string;
    limit?: number;
  },
): Promise<OrganizationActionAuditEventRecord[]> {
  const actionId = options.actionId.trim();
  if (!actionId) {
    return [];
  }
  const limit = Math.max(0, Math.min(options.limit ?? 100, 500));
  if (limit === 0) {
    return [];
  }
  const records = await docStore.list<OrganizationActionAuditEventRecord>(
    AUDIT_COLLECTION,
    { action_id: actionId },
  );
  return records
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-limit);
}

export async function appendOrganizationActionStatus(
  docStore: JsonDocStorePort,
  params: {
    actionId: string;
    status: OrganizationActionStatus;
    actorUserId: string;
    actorName: string;
    note?: string;
  },
): Promise<OrganizationActionServerRecord> {
  const actionId = params.actionId.trim();
  if (!actionId) {
    throw new Error('organization_action_id_required');
  }
  const actorUserId = params.actorUserId.trim();
  const actorName = params.actorName.trim();
  if (!actorUserId || !actorName) {
    throw new Error('organization_action_actor_required');
  }
  const now = new Date().toISOString();
  const event: OrganizationActionAuditEventRecord = {
    id: `org_action_audit_${randomUUID()}`,
    action_id: actionId,
    status: params.status,
    actor_user_id: actorUserId,
    actor_name: actorName,
    note: params.note?.trim() || undefined,
    at: now,
  };
  await docStore.upsert(AUDIT_COLLECTION, event.id, event);
  const current = await docStore.get<OrganizationActionStateRecord>(STATE_COLLECTION, actionId);
  const next: OrganizationActionStateRecord = {
    action_id: actionId,
    status: params.status,
    updated_at: now,
    history_total: (current?.history_total ?? 0) + 1,
  };
  await docStore.upsert(STATE_COLLECTION, actionId, next);
  const history = await listOrganizationActionHistory(docStore, {
    actionId,
    limit: 20,
  });
  return {
    action_id: actionId,
    status: params.status,
    updated_at: now,
    history_total: next.history_total,
    history,
  };
}
