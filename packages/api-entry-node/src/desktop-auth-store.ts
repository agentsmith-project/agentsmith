import { randomUUID } from 'node:crypto';
import type { CachePort } from '@mbos/ports';
import type { AuthenticatedUser } from './auth.js';

const DESKTOP_AUTH_REQUEST_NAMESPACE = 'desktop:auth:request';
const DESKTOP_AUTH_TOKEN_NAMESPACE = 'desktop:auth:token';
const DESKTOP_AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export type DesktopAuthRequestStatus = 'pending' | 'authenticated' | 'exchanged';

type DesktopAuthRequestRecord = {
  request_id: string;
  deployment_base_url: string;
  created_at_ms: number;
  expires_at_ms: number;
  status: DesktopAuthRequestStatus;
  exchange_ticket: string | null;
  completed_at_ms: number | null;
  exchanged_at_ms: number | null;
  completed_user: AuthenticatedUser | null;
};

type DesktopAccessTokenRecord = {
  access_token: string;
  created_at_ms: number;
  user: AuthenticatedUser;
};

export type DesktopAuthRequestSnapshot = {
  request_id: string;
  deployment_base_url: string;
  status: DesktopAuthRequestStatus | 'expired';
  expires_at: string;
  authenticated_user: AuthenticatedUser | null;
  exchange_ticket: string | null;
};

export type ResolvedDesktopAccessToken = {
  access_token: string;
  created_at: string;
  user: AuthenticatedUser;
};

function requestKey(requestId: string): string {
  return `${DESKTOP_AUTH_REQUEST_NAMESPACE}:${requestId}`;
}

function tokenKey(accessToken: string): string {
  return `${DESKTOP_AUTH_TOKEN_NAMESPACE}:${accessToken}`;
}

function remainingTtlSeconds(expiresAtMs: number): number {
  return Math.max(1, Math.ceil(Math.max(1, expiresAtMs - Date.now()) / 1000));
}

function longLivedTtlSeconds(): number {
  return Math.max(1, Math.ceil(DESKTOP_AUTH_TOKEN_TTL_MS / 1000));
}

function toRequestSnapshot(record: DesktopAuthRequestRecord): DesktopAuthRequestSnapshot {
  return {
    request_id: record.request_id,
    deployment_base_url: record.deployment_base_url,
    status: record.expires_at_ms <= Date.now() ? 'expired' : record.status,
    expires_at: new Date(record.expires_at_ms).toISOString(),
    authenticated_user: record.completed_user,
    exchange_ticket: record.status === 'authenticated' ? record.exchange_ticket : null,
  };
}

function toResolvedToken(record: DesktopAccessTokenRecord): ResolvedDesktopAccessToken {
  return {
    access_token: record.access_token,
    created_at: new Date(record.created_at_ms).toISOString(),
    user: record.user,
  };
}

async function readRequestRecord(cache: CachePort, requestId: string): Promise<DesktopAuthRequestRecord | null> {
  if (!requestId.trim()) {
    return null;
  }
  const raw = await cache.get(requestKey(requestId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DesktopAuthRequestRecord;
    if (!parsed || typeof parsed !== 'object') {
      await cache.del(requestKey(requestId));
      return null;
    }
    return parsed;
  } catch {
    await cache.del(requestKey(requestId));
    return null;
  }
}

async function writeRequestRecord(cache: CachePort, record: DesktopAuthRequestRecord): Promise<void> {
  await cache.set(
    requestKey(record.request_id),
    JSON.stringify(record),
    remainingTtlSeconds(record.expires_at_ms),
  );
}

export async function startDesktopAuthRequest(
  cache: CachePort,
  args: {
    deploymentBaseUrl: string;
    ttlMs?: number;
  },
): Promise<DesktopAuthRequestSnapshot> {
  const ttlMs = Math.max(1, args.ttlMs ?? DESKTOP_AUTH_REQUEST_TTL_MS);
  const now = Date.now();
  const requestId = `dreq_${randomUUID().replace(/-/g, '')}`;
  const record: DesktopAuthRequestRecord = {
    request_id: requestId,
    deployment_base_url: args.deploymentBaseUrl,
    created_at_ms: now,
    expires_at_ms: now + ttlMs,
    status: 'pending',
    exchange_ticket: null,
    completed_at_ms: null,
    exchanged_at_ms: null,
    completed_user: null,
  };
  await cache.set(requestKey(requestId), JSON.stringify(record), Math.max(1, Math.ceil(ttlMs / 1000)));
  return toRequestSnapshot(record);
}

export async function getDesktopAuthRequest(
  cache: CachePort,
  requestId: string,
): Promise<DesktopAuthRequestSnapshot | null> {
  const record = await readRequestRecord(cache, requestId);
  if (!record) {
    return null;
  }
  if (record.expires_at_ms <= Date.now()) {
    await cache.del(requestKey(requestId));
    return {
      request_id: record.request_id,
      deployment_base_url: record.deployment_base_url,
      status: 'expired',
      expires_at: new Date(record.expires_at_ms).toISOString(),
      authenticated_user: null,
      exchange_ticket: null,
    };
  }
  return toRequestSnapshot(record);
}

export async function completeDesktopAuthRequest(
  cache: CachePort,
  args: {
    requestId: string;
    user: AuthenticatedUser;
  },
): Promise<DesktopAuthRequestSnapshot | null> {
  const record = await readRequestRecord(cache, args.requestId);
  if (!record) {
    return null;
  }
  if (record.expires_at_ms <= Date.now()) {
    await cache.del(requestKey(args.requestId));
    return null;
  }
  if (record.status !== 'pending') {
    return toRequestSnapshot(record);
  }
  record.status = 'authenticated';
  record.exchange_ticket = `dext_${randomUUID().replace(/-/g, '')}`;
  record.completed_at_ms = Date.now();
  record.completed_user = args.user;
  await writeRequestRecord(cache, record);
  return toRequestSnapshot(record);
}

export async function exchangeDesktopAuthRequest(
  cache: CachePort,
  args: {
    requestId: string;
    exchangeTicket: string;
  },
): Promise<{ accessToken: string; signedInUser: AuthenticatedUser } | null> {
  const record = await readRequestRecord(cache, args.requestId);
  if (!record) {
    return null;
  }
  if (record.expires_at_ms <= Date.now()) {
    await cache.del(requestKey(args.requestId));
    return null;
  }
  if (
    record.status !== 'authenticated'
    || !record.exchange_ticket
    || record.exchange_ticket !== args.exchangeTicket
    || !record.completed_user
  ) {
    return null;
  }

  const accessToken = `dsk_${randomUUID().replace(/-/g, '')}`;
  const tokenRecord: DesktopAccessTokenRecord = {
    access_token: accessToken,
    created_at_ms: Date.now(),
    user: record.completed_user,
  };
  await cache.set(tokenKey(accessToken), JSON.stringify(tokenRecord), longLivedTtlSeconds());
  record.status = 'exchanged';
  record.exchanged_at_ms = Date.now();
  record.exchange_ticket = null;
  await writeRequestRecord(cache, record);
  return {
    accessToken,
    signedInUser: record.completed_user,
  };
}

export async function resolveDesktopAccessToken(
  cache: CachePort,
  accessToken: string,
): Promise<ResolvedDesktopAccessToken | null> {
  if (!accessToken.trim()) {
    return null;
  }
  const raw = await cache.get(tokenKey(accessToken));
  if (!raw) {
    return null;
  }
  try {
    return toResolvedToken(JSON.parse(raw) as DesktopAccessTokenRecord);
  } catch {
    await cache.del(tokenKey(accessToken));
    return null;
  }
}

export async function resetDesktopAuthForTest(
  cache: CachePort,
  args: {
    requestIds?: readonly string[];
    accessTokens?: readonly string[];
  } = {},
): Promise<void> {
  await Promise.all([
    ...(args.requestIds ?? []).map((requestId) => cache.del(requestKey(requestId))),
    ...(args.accessTokens ?? []).map((accessToken) => cache.del(tokenKey(accessToken))),
  ]);
}
