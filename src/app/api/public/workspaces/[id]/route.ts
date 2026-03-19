import { NextResponse } from 'next/server';
import { getPublicSystemWorkspace } from '@/lib/system-admin/workspace-registry';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getPublicSystemWorkspace(id);
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

  return NextResponse.json(
    {
      error_code: 'WORKSPACE_NOT_FOUND',
      error_message: 'workspace_not_found',
    },
    { status: 404 },
  );
}
