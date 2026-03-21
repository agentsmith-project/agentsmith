import type http from 'node:http';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import type { CachePort } from '@mbos/ports';
import { resolveSSETicket } from './sse-ticket-store.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

function keycloakInternalRealmBaseFromEnv(): string | null {
  const base = process.env.INTERNAL_KEYCLOAK_BASE_URL?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim();
  if (base && realm) {
    if (base.endsWith('/realms')) {
      return `${base}/${realm}`;
    }

    if (base.includes('/realms/')) {
      return base.replace(/\/$/, '');
    }

    return `${base.replace(/\/$/, '')}/realms/${realm}`;
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
    if (publicBase.endsWith('/realms')) {
      return `${publicBase}/${realm}`;
    }

    if (publicBase.includes('/realms/')) {
      return publicBase.replace(/\/$/, '');
    }

    return `${publicBase.replace(/\/$/, '')}/realms/${realm}`;
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

  const issuer = keycloakIssuerFromEnv();
  const jwksUrl = keycloakJwksUrlFromEnv();
  if (!issuer || !jwksUrl) {
    return null;
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getRemoteJwks(jwksUrl), {
      issuer,
    }));
  } catch {
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
