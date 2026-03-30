import type http from 'node:http';
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import type { CachePort } from '@mbos/ports';
import { resolveSSETicket } from './sse-ticket-store.js';
import { listPersistedSystemWorkspaces } from './system-workspace-persistence.js';
import type { SystemWorkspaceRecord } from '../../../src/lib/system-admin/workspace-registry/types.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

interface IssuerConfig {
  issuer: string;
  jwksUrl: string;
}

function isReadyKeycloakWorkspaceRecord(workspace: SystemWorkspaceRecord): boolean {
  return workspace.provisioning_status === 'ready'
    && workspace.login_idp.kind === 'keycloak'
    && workspace.login_idp.url.trim().length > 0
    && workspace.login_idp.realm.trim().length > 0;
}

function resolveKeycloakRealmBase(realmsBase: string, realm: string): string | null {
  if (!realmsBase || !realm) {
    return null;
  }

  if (realmsBase.endsWith('/realms')) {
    return `${realmsBase}/${realm}`;
  }

  if (realmsBase.includes('/realms/')) {
    return realmsBase.replace(/\/$/, '');
  }

  return `${realmsBase.replace(/\/$/, '')}/realms/${realm}`;
}

function keycloakInternalRealmBaseFromEnv(): string | null {
  const base = process.env.INTERNAL_KEYCLOAK_BASE_URL?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim();
  if (base && realm) {
    return resolveKeycloakRealmBase(base, realm);
  }

  return null;
}

function keycloakIssuerFromEnv(): string | null {
  const directIssuer = process.env.KEYCLOAK_ISSUER_URL?.trim();
  if (directIssuer) {
    return directIssuer.replace(/\/$/, '');
  }

  const publicBase = process.env.PUBLIC_KEYCLOAK_BASE_URL?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim();
  if (publicBase && realm) {
    return resolveKeycloakRealmBase(publicBase, realm);
  }

  return keycloakInternalRealmBaseFromEnv();
}

function keycloakJwksUrlFromEnv(): string | null {
  const internalRealmBase = keycloakInternalRealmBaseFromEnv();
  if (internalRealmBase) {
    return `${internalRealmBase}/protocol/openid-connect/certs`;
  }

  const issuer = keycloakIssuerFromEnv();
  if (issuer) {
    return `${issuer}/protocol/openid-connect/certs`;
  }

  return null;
}

function deriveKeycloakFetchBaseUrl(idpUrl: string): string {
  const requestedBase = idpUrl.trim().replace(/\/+$/, '');
  const publicBase = process.env.PUBLIC_KEYCLOAK_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const internalBase = process.env.INTERNAL_KEYCLOAK_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  if (publicBase && internalBase && requestedBase === publicBase) {
    return internalBase;
  }
  return requestedBase;
}

function buildIssuerConfig(idpUrl: string, realm: string): IssuerConfig | null {
  const issuer = resolveKeycloakRealmBase(idpUrl.trim(), realm.trim());
  if (!issuer) {
    return null;
  }

  const fetchBase = deriveKeycloakFetchBaseUrl(idpUrl);
  const jwksBase = resolveKeycloakRealmBase(fetchBase, realm.trim());
  if (!jwksBase) {
    return null;
  }

  return {
    issuer,
    jwksUrl: `${jwksBase}/protocol/openid-connect/certs`,
  };
}

async function resolveAllowedIssuerConfigs(): Promise<IssuerConfig[]> {
  const configs: IssuerConfig[] = [];
  const seen = new Set<string>();

  const envIssuer = keycloakIssuerFromEnv();
  const envJwksUrl = keycloakJwksUrlFromEnv();
  if (envIssuer && envJwksUrl) {
    seen.add(envIssuer);
    configs.push({ issuer: envIssuer, jwksUrl: envJwksUrl });
  }

  let workspaces: SystemWorkspaceRecord[] = [];
  try {
    workspaces = await listPersistedSystemWorkspaces();
  } catch {
    return configs;
  }

  for (const workspace of workspaces) {
    if (!isReadyKeycloakWorkspaceRecord(workspace)) {
      continue;
    }

    const config = buildIssuerConfig(workspace.login_idp.url, workspace.login_idp.realm);
    if (!config || seen.has(config.issuer)) {
      continue;
    }

    seen.add(config.issuer);
    configs.push(config);
  }

  return configs;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(jwksUrl: string) {
  const cached = jwksCache.get(jwksUrl);
  if (cached) {
    return cached;
  }

  const created = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, created);
  return created;
}

function readStringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readIssuerClaim(token: string): string | null {
  try {
    return readStringClaim(decodeJwt(token), 'iss');
  } catch {
    return null;
  }
}

export function extractBearerToken(req: http.IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice('bearer '.length).trim();
  return token || null;
}

function extractSSETicket(req: http.IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    const ticket = url.searchParams.get('ticket')?.trim();
    return ticket || null;
  } catch {
    return null;
  }
}

function canUseTicketQuery(req: http.IncomingMessage): boolean {
  try {
    const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    return pathname === '/api/v1/events' || /\/tasks\/[^/]+\/events\/?$/.test(pathname);
  } catch {
    return false;
  }
}

const userInfoCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

export async function verifyBearerToken(
  req: http.IncomingMessage,
  options?: { cache?: CachePort },
): Promise<AuthenticatedUser | null> {
  const headerToken = extractBearerToken(req);
  const ticketToken = canUseTicketQuery(req) && options?.cache
    ? (await resolveSSETicket(options.cache, extractSSETicket(req) ?? ''))?.bearerToken ?? null
    : null;
  const token =
    headerToken
    ?? ticketToken;
  if (!token) {
    return null;
  }

  const now = Date.now();
  const cached = userInfoCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const issuerClaim = readIssuerClaim(token);
  const allowedConfigs = await resolveAllowedIssuerConfigs();
  const defaultIssuer = keycloakIssuerFromEnv();
  const candidateConfigs = issuerClaim
    ? allowedConfigs.filter((config) => config.issuer === issuerClaim)
    : allowedConfigs.filter((config) => config.issuer === defaultIssuer);

  if (candidateConfigs.length === 0) {
    return null;
  }

  let payload: JWTPayload | null = null;
  for (const config of candidateConfigs) {
    try {
      ({ payload } = await jwtVerify(token, getRemoteJwks(config.jwksUrl), {
        issuer: config.issuer,
      }));
      break;
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    return null;
  }

  const subject = readStringClaim(payload, 'sub');
  if (!subject) {
    return null;
  }

  const user: AuthenticatedUser = {
    id: subject,
    email: readStringClaim(payload, 'email') ?? `${subject}@unknown.local`,
    name: readStringClaim(payload, 'name')
      ?? readStringClaim(payload, 'preferred_username')
      ?? readStringClaim(payload, 'email')
      ?? subject,
  };
  userInfoCache.set(token, { user, expiresAt: now + 60_000 });
  return user;
}
