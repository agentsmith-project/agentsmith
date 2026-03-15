import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import { searchKeycloakUsers } from '@/lib/system-admin/keycloak-user-directory';

type SearchDirectoryUsersBody = {
  idp_url?: string;
  idp_realm?: string;
  query?: string;
};

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
