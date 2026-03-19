import type { JsonDocStorePort } from '@mbos/ports';
import { decryptSecretValue, encryptSecretValue } from './secret-crypto.js';

const COLLECTION = 'workspace_integration_settings';

export type WorkspaceFeishuIntegrationStatus =
  | 'not_configured'
  | 'verification_required'
  | 'verified'
  | 'enabled'
  | 'error';

export type WorkspaceFeishuIntegrationRecord = {
  id: string;
  workspace_id: string;
  provider: 'feishu';
  status: WorkspaceFeishuIntegrationStatus;
  app_id: string;
  app_secret?: string;
  redirect_uri: string;
  verified_at: string | null;
  verified_by_user_id?: string | null;
  verified_by_email?: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type StoredWorkspaceFeishuIntegrationRecord = Omit<WorkspaceFeishuIntegrationRecord, 'app_secret'> & {
  app_secret?: string;
};

export type PublicWorkspaceFeishuIntegrationRecord = Omit<WorkspaceFeishuIntegrationRecord, 'app_secret'> & {
  has_app_secret: boolean;
};

function recordId(workspaceId: string): string {
  return `workspace_feishu:${workspaceId}`;
}

function persistRecord(record: WorkspaceFeishuIntegrationRecord): StoredWorkspaceFeishuIntegrationRecord {
  return {
    ...record,
    app_secret: record.app_secret ? encryptSecretValue(record.app_secret) : undefined,
  };
}

function hydrateRecord(record: StoredWorkspaceFeishuIntegrationRecord): WorkspaceFeishuIntegrationRecord {
  return {
    ...record,
    app_secret: record.app_secret ? decryptSecretValue(record.app_secret) : undefined,
  };
}

export function presentWorkspaceFeishuIntegration(
  record: WorkspaceFeishuIntegrationRecord,
): PublicWorkspaceFeishuIntegrationRecord {
  return {
    ...record,
    has_app_secret: Boolean(record.app_secret),
  };
}

export function buildDefaultWorkspaceFeishuIntegration(
  workspaceId: string,
): WorkspaceFeishuIntegrationRecord {
  const now = new Date().toISOString();
  return {
    id: recordId(workspaceId),
    workspace_id: workspaceId,
    provider: 'feishu',
    status: 'not_configured',
    app_id: '',
    app_secret: undefined,
    redirect_uri: '',
    verified_at: null,
    verified_by_user_id: null,
    verified_by_email: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getWorkspaceFeishuIntegration(
  docStore: JsonDocStorePort,
  workspaceId: string,
): Promise<WorkspaceFeishuIntegrationRecord | null> {
  const record = await docStore.get<StoredWorkspaceFeishuIntegrationRecord>(COLLECTION, recordId(workspaceId));
  return record ? hydrateRecord(record) : null;
}

export async function getWorkspaceFeishuIntegrationOrDefault(
  docStore: JsonDocStorePort,
  workspaceId: string,
): Promise<WorkspaceFeishuIntegrationRecord> {
  return (await getWorkspaceFeishuIntegration(docStore, workspaceId))
    ?? buildDefaultWorkspaceFeishuIntegration(workspaceId);
}

export async function upsertWorkspaceFeishuIntegration(
  docStore: JsonDocStorePort,
  record: WorkspaceFeishuIntegrationRecord,
): Promise<WorkspaceFeishuIntegrationRecord> {
  await docStore.upsert<StoredWorkspaceFeishuIntegrationRecord>(COLLECTION, record.id, persistRecord(record));
  return record;
}
