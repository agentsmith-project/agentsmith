import { NextResponse } from 'next/server';
import { getPublicSystemWorkspace } from '@/lib/system-admin/workspace-registry';

function getErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return '';
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : '';
}

function workspaceNotFoundResponse() {
  return NextResponse.json(
    {
      error_code: 'WORKSPACE_NOT_FOUND',
      error_message: 'workspace_not_found',
    },
    { status: 404 },
  );
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let record: Awaited<ReturnType<typeof getPublicSystemWorkspace>>;
  try {
    record = await getPublicSystemWorkspace(id);
  } catch (error) {
    if (getErrorCode(error) === 'WORKSPACE_NOT_FOUND') {
      return workspaceNotFoundResponse();
    }
    console.error('Failed to load public workspace configuration:', error);
    return NextResponse.json(
      {
        error_code: 'WORKSPACE_CONFIG_UNAVAILABLE',
        error_message: 'workspace_config_unavailable',
      },
      { status: 503 },
    );
  }

  if (record) {
    return NextResponse.json({
      id: record.id,
      name: record.name,
      login_idp: {
        kind: record.login_idp.kind,
        url: record.login_idp.url,
        realm: record.login_idp.realm,
        client_id: record.login_idp.client_id,
      },
    });
  }

  return workspaceNotFoundResponse();
}
