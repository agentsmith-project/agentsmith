import { NextResponse } from 'next/server';
import { isSystemAdminAuthenticated } from '@/lib/system-admin/session';
import { disableSystemWorkspace } from '@/lib/system-admin/workspace-registry';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error_code: 'UNAUTHORIZED', error_message: 'unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const updated = await disableSystemWorkspace(id);
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
