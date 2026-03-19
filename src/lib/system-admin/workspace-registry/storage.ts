import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildWorkspaceTenantPreview } from '../config';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceDirectoryIdpConfig,
  SystemWorkspaceLoginIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceIdentitySnapshot,
} from './types';

export function sanitizeRecord(record: SystemWorkspaceRecord): PublicSystemWorkspaceRecord {
  return {
    ...record,
    project_creators: record.project_creators.map((item) => ({ ...item })),
    login_idp: {
      kind: record.login_idp.kind,
      url: record.login_idp.url,
      realm: record.login_idp.realm,
      client_id: record.login_idp.client_id,
    },
    directory_idp: {
      client_id: record.directory_idp?.client_id,
      has_client_secret: Boolean(record.directory_idp?.client_secret),
    },
  };
}

export async function ensureRegistryDir(pathname: string): Promise<void> {
  await mkdir(dirname(pathname), { recursive: true });
}

export function createWorkspaceRecord(
  existingRecords: SystemWorkspaceRecord[],
  input: UpsertSystemWorkspaceInput,
  workspaceAdmin: WorkspaceIdentitySnapshot | null,
): SystemWorkspaceRecord {
  const tenant = buildWorkspaceTenantPreview(input.name);
  if (existingRecords.some((record) => record.id === tenant.workspace_id)) {
    throw Object.assign(new Error('workspace_exists'), { code: 'WORKSPACE_EXISTS' });
  }

  const now = new Date().toISOString();
  return {
    id: tenant.workspace_id,
    name: input.name.trim(),
    workspace_admin: workspaceAdmin?.email ?? input.workspace_admin_email.trim(),
    workspace_admin_user_id: workspaceAdmin?.user_id,
    workspace_admin_name: workspaceAdmin?.name ?? null,
    workspace_admin_binding_required: workspaceAdmin ? false : true,
    project_creators: [],
    login_idp: {
      kind: 'keycloak',
      url: input.login_idp_url.trim(),
      realm: input.login_idp_realm.trim(),
      client_id: input.login_client_id.trim(),
    },
    directory_idp: {
      client_id: input.directory_client_id?.trim() || (input.directory_client_secret?.trim() ? input.login_client_id.trim() : undefined),
      client_secret: input.directory_client_secret?.trim() || undefined,
    },
    tenant,
    provisioning_status: 'draft',
    last_initialized_at: null,
    last_init_error: null,
    created_at: now,
    updated_at: now,
  };
}

export function buildUpdatedWorkspaceRecord(
  existing: SystemWorkspaceRecord,
  input: UpsertSystemWorkspaceInput,
  workspaceAdmin: WorkspaceIdentitySnapshot | null,
): SystemWorkspaceRecord {
  const nextLoginIdp: SystemWorkspaceLoginIdpConfig = {
    kind: 'keycloak',
    url: input.login_idp_url.trim(),
    realm: input.login_idp_realm.trim(),
    client_id: input.login_client_id.trim(),
  };
  const nextDirectoryIdp: SystemWorkspaceDirectoryIdpConfig = {
    client_id: input.directory_client_id?.trim() || (input.directory_client_secret?.trim() ? input.login_client_id.trim() : undefined),
    client_secret: input.directory_client_secret?.trim() || existing.directory_idp?.client_secret,
  };
  const requiresRepublish =
    existing.name !== input.name.trim() ||
    existing.workspace_admin !== (workspaceAdmin?.email ?? input.workspace_admin_email.trim()) ||
    existing.workspace_admin_user_id !== workspaceAdmin?.user_id ||
    Boolean(existing.workspace_admin_binding_required) !== !workspaceAdmin ||
    existing.login_idp.url !== nextLoginIdp.url ||
    existing.login_idp.realm !== nextLoginIdp.realm ||
    existing.login_idp.client_id !== nextLoginIdp.client_id ||
    (existing.directory_idp?.client_id || '') !== (nextDirectoryIdp.client_id || '') ||
    (existing.directory_idp?.client_secret || '') !== (nextDirectoryIdp.client_secret || '');

  return {
    ...existing,
    name: input.name.trim(),
    workspace_admin: workspaceAdmin?.email ?? input.workspace_admin_email.trim(),
    workspace_admin_user_id: workspaceAdmin?.user_id,
    workspace_admin_name: workspaceAdmin?.name ?? null,
    workspace_admin_binding_required: workspaceAdmin ? false : true,
    login_idp: nextLoginIdp,
    directory_idp: nextDirectoryIdp,
    provisioning_status: requiresRepublish ? 'draft' : existing.provisioning_status,
    last_initialized_at: requiresRepublish ? null : existing.last_initialized_at,
    last_init_error: requiresRepublish ? null : existing.last_init_error,
    updated_at: new Date().toISOString(),
  };
}
