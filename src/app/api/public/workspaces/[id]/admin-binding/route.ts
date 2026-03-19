import { NextResponse } from 'next/server';
import { bindPendingWorkspaceAdminByEmail, getPublicSystemWorkspace } from '@/lib/system-admin/workspace-registry';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';

type KeycloakUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
};

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

  const realmBase = resolveKeycloakRealmBase(record.login_idp.url, record.login_idp.realm);
  if (!realmBase) {
    return NextResponse.json({ error_code: 'KEYCLOAK_IDP_INVALID', error_message: 'keycloak_idp_invalid' }, { status: 422 });
  }

  const response = await fetch(`${realmBase}/protocol/openid-connect/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);

  if (!response || !response.ok) {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  const payload = (await response.json()) as KeycloakUserInfo;
  if (!payload.sub || !payload.email) {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  await bindPendingWorkspaceAdminByEmail({
    workspaceId: id,
    user: {
      user_id: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.preferred_username ?? payload.email,
    },
  });

  return NextResponse.json({ ok: true });
}
