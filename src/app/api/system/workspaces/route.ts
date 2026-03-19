import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import {
  createSystemWorkspace,
  listSystemWorkspaces,
  type UpsertSystemWorkspaceInput,
} from '@/lib/system-admin/workspace-registry';
import { badSystemWorkspaceRequest, validateSystemWorkspaceInput } from './_shared/validation';

export async function GET() {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ items: await listSystemWorkspaces() });
}

export async function POST(request: Request) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpsertSystemWorkspaceInput | null;
  const input = validateSystemWorkspaceInput(body);
  if (!input) {
    return badSystemWorkspaceRequest('invalid_system_workspace_payload');
  }

  try {
    const created = await createSystemWorkspace(input);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'WORKSPACE_EXISTS') {
      return NextResponse.json(
        { error_code: 'WORKSPACE_EXISTS', error_message: 'workspace_exists' },
        { status: 409 },
      );
    }
    if (code === 'DIRECTORY_USER_NOT_FOUND') {
      return NextResponse.json(
        { error_code: 'DIRECTORY_USER_NOT_FOUND', error_message: 'directory_user_not_found' },
        { status: 422 },
      );
    }
    if (code === 'KEYCLOAK_IDP_INVALID') {
      return NextResponse.json(
        { error_code: 'KEYCLOAK_IDP_INVALID', error_message: 'keycloak_idp_invalid' },
        { status: 422 },
      );
    }
    if (code === 'KEYCLOAK_DIRECTORY_PERMISSION_REQUIRED') {
      return NextResponse.json(
        {
          error_code: 'KEYCLOAK_DIRECTORY_PERMISSION_REQUIRED',
          error_message: 'keycloak_directory_permission_required',
        },
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
