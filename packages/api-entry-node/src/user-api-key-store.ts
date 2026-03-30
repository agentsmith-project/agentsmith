import { createHash, randomBytes } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

export type UserApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface UserApiKeyRecord {
  id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  key_prefix: string;
  key_hash: string;
  status: UserApiKeyStatus;
  note?: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

const USER_API_KEYS_COLLECTION = 'user_api_keys';

function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function keyId(): string {
  return `ukey_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function plainKey(): string {
  return `asku_${randomBytes(24).toString('hex')}`;
}

function toExpiryIso(expiresInDays?: number): string | undefined {
  if (typeof expiresInDays !== 'number' || !Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    return undefined;
  }
  const cappedDays = Math.min(expiresInDays, 365);
  return new Date(Date.now() + cappedDays * 24 * 60 * 60 * 1000).toISOString();
}

function isExpired(record: UserApiKeyRecord): boolean {
  return typeof record.expires_at === 'string'
    && record.expires_at.trim().length > 0
    && Date.parse(record.expires_at) <= Date.now();
}

function presentRecord(record: UserApiKeyRecord): UserApiKeyRecord {
  if (!isExpired(record) || record.status !== 'active') {
    return record;
  }
  return {
    ...record,
    status: 'expired',
  };
}

export async function listUserApiKeys(
  docStore: JsonDocStorePort,
  userId: string,
): Promise<UserApiKeyRecord[]> {
  const items = await docStore.list<UserApiKeyRecord>(USER_API_KEYS_COLLECTION, { user_id: userId });
  return items
    .map(presentRecord)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createUserApiKey(args: {
  docStore: JsonDocStorePort;
  userId: string;
  userEmail?: string;
  userName?: string;
  note?: string;
  expiresInDays?: number;
}): Promise<{ record: UserApiKeyRecord; key: string }> {
  const key = plainKey();
  const record: UserApiKeyRecord = {
    id: keyId(),
    user_id: args.userId,
    user_email: args.userEmail?.trim() || undefined,
    user_name: args.userName?.trim() || undefined,
    key_prefix: key.slice(0, 12),
    key_hash: hashKey(key),
    status: 'active',
    note: args.note?.trim() || undefined,
    created_at: new Date().toISOString(),
    expires_at: toExpiryIso(args.expiresInDays),
  };
  await args.docStore.upsert(USER_API_KEYS_COLLECTION, record.id, record);
  return { record, key };
}

export async function revokeUserApiKey(args: {
  docStore: JsonDocStorePort;
  userId: string;
  keyId: string;
}): Promise<boolean> {
  const existing = await args.docStore.get<UserApiKeyRecord>(USER_API_KEYS_COLLECTION, args.keyId);
  if (!existing || existing.user_id !== args.userId) {
    return false;
  }
  await args.docStore.upsert(USER_API_KEYS_COLLECTION, existing.id, {
    ...existing,
    status: 'revoked',
  });
  return true;
}

export async function verifyUserApiKey(
  docStore: JsonDocStorePort,
  token: string,
): Promise<UserApiKeyRecord | null> {
  const hash = hashKey(token);
  const active = await docStore.list<UserApiKeyRecord>(USER_API_KEYS_COLLECTION, { status: 'active' });
  const matched = active.find((item) => item.key_hash === hash) ?? null;
  if (!matched) {
    return null;
  }
  if (isExpired(matched)) {
    await docStore.upsert(USER_API_KEYS_COLLECTION, matched.id, {
      ...matched,
      status: 'expired',
    });
    return null;
  }
  const touched: UserApiKeyRecord = {
    ...matched,
    last_used_at: new Date().toISOString(),
  };
  await docStore.upsert(USER_API_KEYS_COLLECTION, touched.id, touched);
  return touched;
}
