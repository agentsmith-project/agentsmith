import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import {
  verifyKeycloakIdentityProvider,
  verifyKeycloakLoginIdentityProvider,
} from '@/lib/system-admin/keycloak-user-directory';
import { getSystemWorkspace } from '@/lib/system-admin/workspace-registry';

type VerifyIdpBody = {
  workspace_id?: string;
  login_idp_url?: string;
  login_idp_realm?: string;
  login_client_id?: string;
  directory_client_id?: string;
  directory_client_secret?: string;
};

export async function POST(request: Request) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as VerifyIdpBody | null;
  const legacyBody = body as VerifyIdpBody & {
    idp_url?: string;
    idp_realm?: string;
    idp_client_id?: string;
    idp_client_secret?: string;
  };
  const workspaceId = body?.workspace_id?.trim() ?? '';
  const idpUrl = body?.login_idp_url?.trim() ?? legacyBody?.idp_url?.trim() ?? '';
  const idpRealm = body?.login_idp_realm?.trim() ?? legacyBody?.idp_realm?.trim() ?? '';
  const loginClientId = body?.login_client_id?.trim() ?? legacyBody?.idp_client_id?.trim() ?? '';
  const requestedDirectoryClientId = body?.directory_client_id?.trim() ?? legacyBody?.idp_client_id?.trim() ?? '';
  const providedClientSecret = body?.directory_client_secret?.trim() ?? legacyBody?.idp_client_secret?.trim() ?? '';
  const persisted = workspaceId ? await getSystemWorkspace(workspaceId) : null;
  const directoryClientId = requestedDirectoryClientId || (providedClientSecret ? loginClientId : (persisted?.directory_idp?.client_id?.trim() ?? ''));
  const idpClientSecret = providedClientSecret || persisted?.directory_idp?.client_secret?.trim() || '';

  if (!idpUrl || !idpRealm || !loginClientId) {
    return NextResponse.json(
      { error_code: 'VALIDATION_ERROR', error_message: 'invalid_system_workspace_payload' },
      { status: 400 },
    );
  }

  try {
    await verifyKeycloakLoginIdentityProvider({
      idpUrl,
      realm: idpRealm,
    });

    if (!directoryClientId) {
      return NextResponse.json({
        idp_ok: true,
        directory_search_supported: false,
        advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
      });
    }

    const result = await verifyKeycloakIdentityProvider({
      idpUrl,
      realm: idpRealm,
      clientId: directoryClientId,
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
