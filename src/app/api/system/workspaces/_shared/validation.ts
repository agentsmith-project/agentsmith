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
  if (!body.workspace_admin_mode || !['directory_user', 'email_pending'].includes(body.workspace_admin_mode)) return null;
  if (!body.workspace_admin_email?.trim()) return null;
  if (body.workspace_admin_mode === 'directory_user' && !body.workspace_admin_user_id?.trim()) return null;
  if (!body.login_idp_url?.trim()) return null;
  if (!body.login_idp_realm?.trim()) return null;
  if (!body.login_client_id?.trim()) return null;
  return body;
}
