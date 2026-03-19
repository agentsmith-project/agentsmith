import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import { verifyKeycloakIdentityProvider } from '@/lib/system-admin/keycloak-user-directory';
import { getSystemWorkspace } from '@/lib/system-admin/workspace-registry';

type VerifyIdpBody = {
  workspace_id?: string;
  idp_url?: string;
  idp_realm?: string;
  idp_client_id?: string;
  idp_client_secret?: string;
};

export async function POST(request: Request) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as VerifyIdpBody | null;
  const workspaceId = body?.workspace_id?.trim() ?? '';
  const idpUrl = body?.idp_url?.trim() ?? '';
  const idpRealm = body?.idp_realm?.trim() ?? '';
  const idpClientId = body?.idp_client_id?.trim() ?? '';
  const providedClientSecret = body?.idp_client_secret?.trim() ?? '';
  const persisted = workspaceId ? await getSystemWorkspace(workspaceId) : null;
  const idpClientSecret = providedClientSecret || persisted?.idp.client_secret?.trim() || '';

  if (!idpUrl || !idpRealm || !idpClientId) {
    return NextResponse.json(
      { error_code: 'VALIDATION_ERROR', error_message: 'invalid_system_workspace_payload' },
      { status: 400 },
    );
  }

  try {
    const result = await verifyKeycloakIdentityProvider({
      idpUrl,
      realm: idpRealm,
      clientId: idpClientId,
      clientSecret: idpClientSecret || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'KEYCLOAK_IDP_INVALID') {
      return NextResponse.json(
        { error_code: 'KEYCLOAK_IDP_INVALID', error_message: 'keycloak_idp_invalid' },
        { status: 422 },
      );
    }
    if (code === 'KEYCLOAK_DIRECTORY_UNAVAILABLE') {
      return NextResponse.json(
        { error_code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE', error_message: 'keycloak_directory_unavailable' },
        { status: 503 },
      );
    }
    throw error;
  }
}
