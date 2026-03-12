import { NextResponse } from 'next/server';
import { getSystemWorkspace } from '@/lib/system-admin/workspace-registry';

function getDefaultWorkspaceLoginConfig(id: string) {
  const defaultWorkspaceId = process.env.MBOS_DEFAULT_WORKSPACE_ID?.trim() || 'ws_default';
  if (id !== defaultWorkspaceId) {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL?.trim() || '';
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM?.trim() || '';
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?.trim() || '';
  if (!url || !realm || !clientId) {
    return null;
  }

  return {
    id: defaultWorkspaceId,
    name: process.env.MBOS_DEFAULT_WORKSPACE_NAME?.trim() || 'Default Workspace',
    idp: {
      kind: 'keycloak' as const,
      url,
      realm,
      client_id: clientId,
    },
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getSystemWorkspace(id);
  if (record) {
    return NextResponse.json({
      id: record.id,
      name: record.name,
      idp: {
        kind: record.idp.kind,
        url: record.idp.url,
        realm: record.idp.realm,
        client_id: record.idp.client_id,
      },
    });
  }

  const fallback = getDefaultWorkspaceLoginConfig(id);
  if (fallback) {
    return NextResponse.json(fallback);
  }

  return NextResponse.json(
    {
      error_code: 'WORKSPACE_NOT_FOUND',
      error_message: 'workspace_not_found',
    },
    { status: 404 },
  );
}
