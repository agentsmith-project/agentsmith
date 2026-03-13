import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import {
  deleteSystemWorkspace,
  updateSystemWorkspace,
  type UpsertSystemWorkspaceInput,
} from '@/lib/system-admin/workspace-registry';
import { badSystemWorkspaceRequest, validateSystemWorkspaceInput } from '../_shared/validation';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as UpsertSystemWorkspaceInput | null;
  const input = validateSystemWorkspaceInput(body);
  if (!input) {
    return badSystemWorkspaceRequest('invalid_system_workspace_payload');
  }

  try {
    const updated = await updateSystemWorkspace(id, input);
    return NextResponse.json(updated);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'WORKSPACE_NOT_FOUND') {
      return NextResponse.json(
        { error_code: 'RESOURCE_NOT_FOUND', error_message: 'workspace_not_found' },
        { status: 404 },
      );
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await deleteSystemWorkspace(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'WORKSPACE_NOT_FOUND') {
      return NextResponse.json(
        { error_code: 'RESOURCE_NOT_FOUND', error_message: 'workspace_not_found' },
        { status: 404 },
      );
    }
    if (code === 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE') {
      return NextResponse.json(
        {
          error_code: 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE',
          error_message: 'workspace_disable_required_before_delete',
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
