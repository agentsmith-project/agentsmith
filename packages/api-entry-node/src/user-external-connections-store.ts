import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import { decryptSecretValue, encryptSecretValue } from './secret-crypto.js';

export type UserExternalConnectionProvider = 'custom';
export type UserExternalConnectionKind = 'secret_bundle';
export type UserExternalConnectionStatus = 'active' | 'expired' | 'reauth_required' | 'error';

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

export type UserExternalConnectionRecord = {
  id: string;
  user_id: string;
  provider: UserExternalConnectionProvider;
  custom_domain?: string | null;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status: UserExternalConnectionStatus;
  fields: UserExternalConnectionFieldRecord[];
  last_used_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

type PersistedUserExternalConnectionRecord = Omit<UserExternalConnectionRecord, 'fields'> & {
  fields: PersistedUserExternalConnectionFieldRecord[];
};

type StoredUserExternalConnectionRecord = Omit<
  Partial<PersistedUserExternalConnectionRecord>,
  'provider' | 'kind' | 'fields'
> & {
  provider?: unknown;
  kind?: unknown;
  fields?: unknown;
};

const COLLECTION = 'user_external_connections';

export function isUserExternalConnectionProvider(value: unknown): value is UserExternalConnectionProvider {
  return value === 'custom';
}

export function isUserExternalConnectionKind(value: unknown): value is UserExternalConnectionKind {
  return value === 'secret_bundle';
}

export function isUserExternalConnectionStatus(value: unknown): value is UserExternalConnectionStatus {
  return value === 'active'
    || value === 'expired'
    || value === 'reauth_required'
    || value === 'error';
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

function isSupportedPersistedRecord(
  record: StoredUserExternalConnectionRecord | null,
): record is PersistedUserExternalConnectionRecord {
  return record !== null
    && record.provider === 'custom'
    && record.kind === 'secret_bundle'
    && Array.isArray(record.fields);
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
  const items = await docStore.list<StoredUserExternalConnectionRecord>(COLLECTION);
  const filtered = items
    .filter(isSupportedPersistedRecord)
    .filter((item) => item.user_id === userId)
    .map(hydrateRecord);
  return filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getUserExternalConnection(
  docStore: JsonDocStorePort,
  userId: string,
  connectionId: string,
): Promise<UserExternalConnectionRecord | null> {
  const record = await docStore.get<StoredUserExternalConnectionRecord>(COLLECTION, connectionId);
  if (!record || record.user_id !== userId || !isSupportedPersistedRecord(record)) {
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
