import { NextResponse } from 'next/server';
import { listPublicSystemWorkspaces } from '@/lib/system-admin/workspace-registry';

export async function GET() {
  const items = await listPublicSystemWorkspaces();
  return NextResponse.json({
    items: items.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
    })),
    total: items.length,
  });
}
