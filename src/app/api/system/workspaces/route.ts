import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import {
  createSystemWorkspace,
  listPublicSystemWorkspaces,
  type UpsertSystemWorkspaceInput,
} from '@/lib/system-admin/workspace-registry';

function badRequest(message: string) {
  return NextResponse.json({ error_code: 'VALIDATION_ERROR', error_message: message }, { status: 400 });
}

function validateInput(body: UpsertSystemWorkspaceInput | null): UpsertSystemWorkspaceInput | null {
  if (!body) return null;
  if (!body.name?.trim()) return null;
  if (!body.workspace_admin?.trim()) return null;
  if (!body.idp_url?.trim()) return null;
  if (!body.idp_realm?.trim()) return null;
  if (!body.idp_client_id?.trim()) return null;
  return body;
}

export async function GET() {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ items: await listPublicSystemWorkspaces() });
}

export async function POST(request: Request) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpsertSystemWorkspaceInput | null;
  const input = validateInput(body);
  if (!input) {
    return badRequest('invalid_system_workspace_payload');
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
    throw error;
  }
}
