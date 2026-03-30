import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import { searchKeycloakUsers } from '@/lib/system-admin/keycloak-user-directory';
import { getSystemWorkspace } from '@/lib/system-admin/workspace-registry';

type SearchDirectoryUsersBody = {
  workspace_id?: string;
  login_idp_url?: string;
  login_idp_realm?: string;
  login_client_id?: string;
  directory_client_id?: string;
  directory_client_secret?: string;
  query?: string;
};

const MOCK_DIRECTORY_USERS = [
  { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
  { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
  { user_id: 'kc-integration-member', email: 'integration-member@example.com', name: 'Integration Member' },
];

export async function POST(request: Request) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SearchDirectoryUsersBody | null;
  const legacyBody = body as SearchDirectoryUsersBody & {
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
  const idpClientId = requestedDirectoryClientId
    || (providedClientSecret ? (loginClientId || persisted?.login_idp.client_id?.trim() || '') : (persisted?.directory_idp?.client_id?.trim() || ''));
  const idpClientSecret = providedClientSecret || persisted?.directory_idp?.client_secret?.trim() || '';
  const query = body?.query?.trim() ?? '';
  if (!idpUrl || !idpRealm || !idpClientId || !idpClientSecret || query.length < 2) {
    return NextResponse.json({ items: [], total: 0 });
  }

  if (process.env.NEXT_PUBLIC_USE_MSW === 'true') {
    const normalizedQuery = query.toLowerCase();
    const items = MOCK_DIRECTORY_USERS.filter((user) => (
      user.email.toLowerCase().includes(normalizedQuery) ||
      user.name.toLowerCase().includes(normalizedQuery)
    ));
    return NextResponse.json({ items, total: items.length });
  }

  try {
    const items = await searchKeycloakUsers({
      idpUrl,
      realm: idpRealm,
      clientId: idpClientId,
      clientSecret: idpClientSecret,
      query,
    });
    return NextResponse.json({ items, total: items.length });
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
