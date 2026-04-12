import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import { decryptSecretValue, encryptSecretValue } from './secret-crypto.js';

export type UserExternalConnectionProvider = 'feishu' | 'jira' | 'github' | 'gitee' | 'custom';
export type UserExternalConnectionKind = 'oauth_account' | 'secret_bundle' | 'ssh_keypair';
export type UserExternalConnectionStatus = 'active' | 'expired' | 'reauth_required' | 'error';
export type UserExternalConnectionReauthReason =
  | 'missing_scopes'
  | 'refresh_failed'
  | 'refresh_token_missing'
  | 'oauth_not_configured'
  | 'unknown';

export type UserExternalConnectionFieldRecord = {
  key: string;
  value: string;
  description?: string | null;
  secret: boolean;
};

type PersistedUserExternalConnectionFieldRecord = {
  key: string;
  value: string;
  description?: string | null;
  secret: boolean;
};

export type UserExternalConnectionAccountIdentity = {
  external_user_id?: string | null;
  external_name?: string | null;
  external_email?: string | null;
  tenant_id?: string | null;
};

export type UserExternalConnectionRecord = {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  provider: UserExternalConnectionProvider;
  custom_domain?: string | null;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status: UserExternalConnectionStatus;
  fields: UserExternalConnectionFieldRecord[];
  account_identity?: UserExternalConnectionAccountIdentity | null;
  scopes?: string[] | null;
  expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_used_at?: string | null;
  last_error?: string | null;
  reauth_reason?: UserExternalConnectionReauthReason | null;
  missing_scopes?: string[] | null;
  created_at: string;
  updated_at: string;
};

type PersistedUserExternalConnectionRecord = Omit<UserExternalConnectionRecord, 'fields'> & {
  fields: PersistedUserExternalConnectionFieldRecord[];
};

const COLLECTION = 'user_external_connections';

export function isUserExternalConnectionProvider(value: unknown): value is UserExternalConnectionProvider {
  return value === 'feishu'
    || value === 'jira'
    || value === 'github'
    || value === 'gitee'
    || value === 'custom';
}

export function isUserExternalConnectionKind(value: unknown): value is UserExternalConnectionKind {
  return value === 'oauth_account'
    || value === 'secret_bundle'
    || value === 'ssh_keypair';
}

export function isUserExternalConnectionStatus(value: unknown): value is UserExternalConnectionStatus {
  return value === 'active'
    || value === 'expired'
    || value === 'reauth_required'
    || value === 'error';
}

export function isUserExternalConnectionReauthReason(value: unknown): value is UserExternalConnectionReauthReason {
  return value === 'missing_scopes'
    || value === 'refresh_failed'
    || value === 'refresh_token_missing'
    || value === 'oauth_not_configured'
    || value === 'unknown';
}

export function normalizeStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

export function normalizeExternalConnectionFields(value: unknown): UserExternalConnectionFieldRecord[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const next = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    const fieldValue = typeof raw.value === 'string' ? raw.value : '';
    if (!key || !fieldValue) return [];
    return [{
      key,
      value: fieldValue,
      description: typeof raw.description === 'string' ? raw.description.trim() || null : null,
      secret: raw.secret !== false,
    }];
  });
  return next;
}

export function selectUserExternalConnectionForProvider(
  connections: UserExternalConnectionRecord[],
  provider: UserExternalConnectionProvider,
  workspaceId?: string | null,
): UserExternalConnectionRecord | null {
  const candidates = connections.filter((item) => item.provider === provider);
  if (candidates.length === 0) return null;
  if (workspaceId) {
    const activeInWorkspace = candidates.find((item) => item.workspace_id === workspaceId && item.status === 'active');
    if (activeInWorkspace) return activeInWorkspace;
    const scoped = candidates.find((item) => item.workspace_id === workspaceId);
    if (scoped) return scoped;
  }
  return candidates.find((item) => item.status === 'active')
    ?? candidates[0]
    ?? null;
}

export function mergeExternalConnectionFields(
  existing: UserExternalConnectionFieldRecord[],
  value: unknown,
): UserExternalConnectionFieldRecord[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const next = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!key) return [];
    const incomingValue = typeof raw.value === 'string' ? raw.value : '';
    const secret = raw.secret !== false;
    const existingField = existing.find((field) => field.key === key);
    if (!incomingValue && secret && existingField?.secret) {
      return [{
        key,
        value: existingField.value,
        description: typeof raw.description === 'string' ? raw.description.trim() || null : existingField.description ?? null,
        secret: true,
      }];
    }
    if (!incomingValue) return [];
    return [{
      key,
      value: incomingValue,
      description: typeof raw.description === 'string' ? raw.description.trim() || null : existingField?.description ?? null,
      secret,
    }];
  });
  return next;
}

export function maskExternalConnectionValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

export function presentUserExternalConnection(record: UserExternalConnectionRecord) {
  return {
    ...record,
    fields: record.fields.map((field) => ({
      key: field.key,
      description: field.description ?? null,
      secret: field.secret,
      masked_value: field.secret ? maskExternalConnectionValue(field.value) : field.value,
    })),
  };
}

function encryptFields(fields: UserExternalConnectionFieldRecord[]): PersistedUserExternalConnectionFieldRecord[] {
  return fields.map((field) => ({
    ...field,
    value: field.secret ? encryptSecretValue(field.value) : field.value,
  }));
}

function decryptFields(fields: PersistedUserExternalConnectionFieldRecord[]): UserExternalConnectionFieldRecord[] {
  return fields.map((field) => ({
    ...field,
    value: field.secret ? decryptSecretValue(field.value) : field.value,
  }));
}

function hydrateRecord(record: PersistedUserExternalConnectionRecord): UserExternalConnectionRecord {
  return {
    ...record,
    fields: decryptFields(record.fields),
  };
}

function persistRecord(record: UserExternalConnectionRecord): PersistedUserExternalConnectionRecord {
  return {
    ...record,
    fields: encryptFields(record.fields),
  };
}

export async function listUserExternalConnections(
  docStore: JsonDocStorePort,
  userId: string,
): Promise<UserExternalConnectionRecord[]> {
  const items = await docStore.list<PersistedUserExternalConnectionRecord>(COLLECTION);
  const filtered = items.filter((item) => item.user_id === userId).map(hydrateRecord);
  return filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getUserExternalConnection(
  docStore: JsonDocStorePort,
  userId: string,
  connectionId: string,
): Promise<UserExternalConnectionRecord | null> {
  const record = await docStore.get<PersistedUserExternalConnectionRecord>(COLLECTION, connectionId);
  if (!record || record.user_id !== userId) {
    return null;
  }
  return hydrateRecord(record);
}

export async function createUserExternalConnection(
  docStore: JsonDocStorePort,
  input: Omit<UserExternalConnectionRecord, 'id' | 'created_at' | 'updated_at'>,
): Promise<UserExternalConnectionRecord> {
  const now = new Date().toISOString();
  const record: UserExternalConnectionRecord = {
    ...input,
    id: `uec_${randomUUID().replace(/-/g, '')}`,
    created_at: now,
    updated_at: now,
  };
  await docStore.upsert(COLLECTION, record.id, persistRecord(record));
  return record;
}

export async function updateUserExternalConnection(
  docStore: JsonDocStorePort,
  userId: string,
  connectionId: string,
  patch: Partial<Omit<UserExternalConnectionRecord, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<UserExternalConnectionRecord | null> {
  const existing = await getUserExternalConnection(docStore, userId, connectionId);
  if (!existing) return null;
  const next: UserExternalConnectionRecord = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await docStore.upsert(COLLECTION, next.id, persistRecord(next));
  return next;
}

export async function deleteUserExternalConnection(
  docStore: JsonDocStorePort,
  userId: string,
  connectionId: string,
): Promise<boolean> {
  const existing = await getUserExternalConnection(docStore, userId, connectionId);
  if (!existing) return false;
  await docStore.delete(COLLECTION, connectionId);
  return true;
}

export async function upsertUserExternalConnectionByProvider(
  docStore: JsonDocStorePort,
  input: Omit<UserExternalConnectionRecord, 'id' | 'created_at' | 'updated_at'>,
): Promise<UserExternalConnectionRecord> {
  const existing = (await listUserExternalConnections(docStore, input.user_id)).find(
    (item) =>
      item.provider === input.provider
      && item.kind === input.kind
      && (item.workspace_id ?? null) === (input.workspace_id ?? null),
  );
  if (!existing) {
    return createUserExternalConnection(docStore, input);
  }
  const next: UserExternalConnectionRecord = {
    ...existing,
    ...input,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };
  await docStore.upsert(COLLECTION, next.id, persistRecord(next));
  return next;
}
