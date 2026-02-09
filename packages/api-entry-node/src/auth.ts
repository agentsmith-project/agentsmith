import type http from 'node:http';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

interface KeycloakUserInfoResponse {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

function keycloakRealmBaseFromEnv(): string | null {
  const directIssuer = process.env.KEYCLOAK_ISSUER_URL?.trim();
  if (directIssuer) {
    return directIssuer.replace(/\/$/, '');
  }

  const base = process.env.KEYCLOAK_BASE_URL?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim();
  if (!base || !realm) {
    return null;
  }

  if (base.endsWith('/realms')) {
    return `${base}/${realm}`;
  }

  if (base.includes('/realms/')) {
    return base.replace(/\/$/, '');
  }

  return `${base.replace(/\/$/, '')}/realms/${realm}`;
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice('bearer '.length).trim();
  return token || null;
}

const userInfoCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

export async function verifyBearerToken(req: http.IncomingMessage): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const now = Date.now();
  const cached = userInfoCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const realmBase = keycloakRealmBaseFromEnv();
  if (!realmBase) {
    return null;
  }

  const userinfoUrl = `${realmBase}/protocol/openid-connect/userinfo`;
  const response = await fetch(userinfoUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as KeycloakUserInfoResponse;
  if (!payload.sub) {
    return null;
  }

  const user: AuthenticatedUser = {
    id: payload.sub,
    email: payload.email ?? `${payload.sub}@unknown.local`,
    name: payload.name ?? payload.preferred_username ?? payload.email ?? payload.sub,
  };
  userInfoCache.set(token, { user, expiresAt: now + 60_000 });
  return user;
}
