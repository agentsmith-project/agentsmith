import { NextResponse } from 'next/server';
import type { UpsertSystemWorkspaceInput } from '@/lib/system-admin/workspace-registry';

export function badSystemWorkspaceRequest(message: string) {
  return NextResponse.json({ error_code: 'VALIDATION_ERROR', error_message: message }, { status: 400 });
}

export function validateSystemWorkspaceInput(
  body: UpsertSystemWorkspaceInput | null,
): UpsertSystemWorkspaceInput | null {
  if (!body) return null;
  if (!body.name?.trim()) return null;
  if (!body.workspace_admin?.trim()) return null;
  if (!body.idp_url?.trim()) return null;
  if (!body.idp_realm?.trim()) return null;
  if (!body.idp_client_id?.trim()) return null;
  return body;
}
