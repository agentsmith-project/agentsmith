import type {
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
  UserExternalConnection,
  UserExternalConnectionField,
  UserExternalConnectionFieldInput,
} from '@/lib/api';

type ExternalConnectionSeed = Omit<
  UserExternalConnection,
  'id' | 'user_id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
};

const connectionsByUser = new Map<string, UserExternalConnection[]>();

function nowIso() {
  return new Date().toISOString();
}

export function buildMockExternalConnectionId(displayName: string, fallbackProvider: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `uec_${slug || fallbackProvider}`;
}

function cloneField(field: UserExternalConnectionField | UserExternalConnectionFieldInput): UserExternalConnectionField {
  return {
    key: field.key,
    description: field.description ?? null,
    secret: field.secret !== false,
    masked_value: 'masked_value' in field ? field.masked_value ?? null : null,
  };
}

function cloneConnection(connection: UserExternalConnection): UserExternalConnection {
  return {
    ...connection,
    fields: connection.fields.map((field) => ({ ...field })),
    account_identity: connection.account_identity ? { ...connection.account_identity } : connection.account_identity,
    scopes: connection.scopes ? [...connection.scopes] : connection.scopes,
    missing_scopes: connection.missing_scopes ? [...connection.missing_scopes] : connection.missing_scopes,
  };
}

function getBucket(userId: string): UserExternalConnection[] {
  const existing = connectionsByUser.get(userId);
  if (existing) return existing;
  const bucket: UserExternalConnection[] = [];
  connectionsByUser.set(userId, bucket);
  return bucket;
}

export function listMockExternalConnections(userId: string): UserExternalConnection[] {
  return getBucket(userId).map(cloneConnection);
}

export function seedMockExternalConnection(userId: string, seed: ExternalConnectionSeed): UserExternalConnection {
  const connection: UserExternalConnection = {
    ...seed,
    id: seed.id ?? buildMockExternalConnectionId(seed.display_name, seed.provider),
    user_id: seed.user_id ?? userId,
    created_at: seed.created_at ?? nowIso(),
    updated_at: seed.updated_at ?? seed.created_at ?? nowIso(),
    custom_domain: seed.custom_domain ?? null,
    note: seed.note ?? null,
    account_identity: seed.account_identity ?? null,
    scopes: seed.scopes ?? null,
    expires_at: seed.expires_at ?? null,
    last_refreshed_at: seed.last_refreshed_at ?? null,
    last_used_at: seed.last_used_at ?? null,
    last_error: seed.last_error ?? null,
    reauth_reason: seed.reauth_reason ?? null,
    missing_scopes: seed.missing_scopes ?? null,
    fields: seed.fields.map(cloneField),
  };
  getBucket(userId).push(connection);
  return cloneConnection(connection);
}

export function seedMockExternalConnections(userId: string, seeds: ExternalConnectionSeed[]): UserExternalConnection[] {
  return seeds.map((seed) => seedMockExternalConnection(userId, seed));
}

export function createMockExternalConnection(
  userId: string,
  request: CreateUserExternalConnectionRequest,
): UserExternalConnection {
  const connection = seedMockExternalConnection(userId, {
    id: `uec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    provider: request.provider,
    kind: request.kind,
    display_name: request.display_name,
    custom_domain: request.custom_domain ?? null,
    note: request.note ?? null,
    status: request.status ?? 'active',
    fields: (request.fields ?? []).map(cloneField),
    account_identity: request.account_identity ?? null,
    scopes: request.scopes ?? null,
    expires_at: request.expires_at ?? null,
    last_refreshed_at: null,
    last_used_at: null,
    last_error: request.last_error ?? null,
    reauth_reason: request.reauth_reason ?? null,
    missing_scopes: request.missing_scopes ?? null,
  });
  return connection;
}

export function updateMockExternalConnection(
  userId: string,
  connectionId: string,
  request: UpdateUserExternalConnectionRequest,
): UserExternalConnection | null {
  const bucket = getBucket(userId);
  const connection = bucket.find((item) => item.id === connectionId);
  if (!connection) return null;

  if (request.custom_domain !== undefined) {
    connection.custom_domain = request.custom_domain ?? null;
  }
  if (request.display_name !== undefined) {
    connection.display_name = request.display_name;
  }
  if (request.note !== undefined) {
    connection.note = request.note ?? null;
  }
  if (request.status !== undefined) {
    connection.status = request.status;
  }
  if (request.fields !== undefined) {
    connection.fields = request.fields.map(cloneField);
  }
  if (request.account_identity !== undefined) {
    connection.account_identity = request.account_identity ?? null;
  }
  if (request.scopes !== undefined) {
    connection.scopes = request.scopes ?? null;
  }
  if (request.expires_at !== undefined) {
    connection.expires_at = request.expires_at ?? null;
  }
  if (request.last_error !== undefined) {
    connection.last_error = request.last_error ?? null;
  }
  if (request.reauth_reason !== undefined) {
    connection.reauth_reason = request.reauth_reason ?? null;
  }
  if (request.missing_scopes !== undefined) {
    connection.missing_scopes = request.missing_scopes ?? null;
  }
  connection.updated_at = nowIso();
  return cloneConnection(connection);
}

export function deleteMockExternalConnection(userId: string, connectionId: string): boolean {
  const bucket = getBucket(userId);
  const index = bucket.findIndex((item) => item.id === connectionId);
  if (index < 0) return false;
  bucket.splice(index, 1);
  return true;
}
