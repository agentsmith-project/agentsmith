import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { bindPendingWorkspaceAdminByEmail, getPublicSystemWorkspace } from '@/lib/system-admin/workspace-registry';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';

type VerifiedWorkspaceUser = {
  sub: string;
  email: string;
  name: string | null;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function deriveKeycloakFetchBaseUrl(idpUrl: string): string {
  const requestedBase = idpUrl.trim().replace(/\/+$/, '');
  const publicBase = process.env.PUBLIC_KEYCLOAK_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const internalBase = process.env.INTERNAL_KEYCLOAK_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  if (publicBase && internalBase && requestedBase === publicBase) {
    return internalBase;
  }
  return requestedBase;
}

function readStringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getRemoteJwks(jwksUrl: string) {
  const cached = jwksCache.get(jwksUrl);
  if (cached) {
    return cached;
  }
  const created = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, created);
  return created;
}

async function verifyWorkspaceBearerToken(args: {
  token: string;
  idpUrl: string;
  realm: string;
}): Promise<VerifiedWorkspaceUser | null> {
  const issuer = resolveKeycloakRealmBase(args.idpUrl, args.realm);
  if (!issuer) {
    return null;
  }
  const fetchBase = deriveKeycloakFetchBaseUrl(args.idpUrl);
  const jwksBase = resolveKeycloakRealmBase(fetchBase, args.realm);
  if (!jwksBase) {
    return null;
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(args.token, getRemoteJwks(`${jwksBase}/protocol/openid-connect/certs`), {
      issuer,
    }));
  } catch {
    return null;
  }

  const sub = readStringClaim(payload, 'sub');
  const email = readStringClaim(payload, 'email');
  if (!sub || !email) {
    return null;
  }

  return {
    sub,
    email,
    name: readStringClaim(payload, 'name') ?? readStringClaim(payload, 'preferred_username'),
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getPublicSystemWorkspace(id);
  if (!record) {
    return NextResponse.json(
      { error_code: 'WORKSPACE_NOT_FOUND', error_message: 'workspace_not_found' },
      { status: 404 },
    );
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (!token) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const verifiedUser = await verifyWorkspaceBearerToken({
    token,
    idpUrl: record.login_idp.url,
    realm: record.login_idp.realm,
  });
  if (!verifiedUser) {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  await bindPendingWorkspaceAdminByEmail({
    workspaceId: id,
    user: {
      user_id: verifiedUser.sub,
      email: verifiedUser.email,
      name: verifiedUser.name ?? verifiedUser.email,
    },
  });

  return NextResponse.json({ ok: true });
}
