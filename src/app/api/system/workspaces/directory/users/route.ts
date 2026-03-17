import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import { searchKeycloakUsers } from '@/lib/system-admin/keycloak-user-directory';

type SearchDirectoryUsersBody = {
  idp_url?: string;
  idp_realm?: string;
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
  const idpUrl = body?.idp_url?.trim() ?? '';
  const idpRealm = body?.idp_realm?.trim() ?? '';
  const query = body?.query?.trim() ?? '';
  if (!idpUrl || !idpRealm || query.length < 2) {
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
      query,
    });
    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'KEYCLOAK_DIRECTORY_UNAVAILABLE') {
      return NextResponse.json(
        { error_code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE', error_message: 'keycloak_directory_unavailable' },
        { status: 503 },
      );
    }
    throw error;
  }
}
