import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildWorkspaceTenantPreview } from '../config';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceIdentitySnapshot,
} from './types';

export function sanitizeRecord(record: SystemWorkspaceRecord): PublicSystemWorkspaceRecord {
  return {
    ...record,
    project_creators: record.project_creators.map((item) => ({ ...item })),
    idp: {
      kind: record.idp.kind,
      url: record.idp.url,
      realm: record.idp.realm,
      client_id: record.idp.client_id,
      has_client_secret: Boolean(record.idp.client_secret),
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
    idp: {
      kind: 'keycloak',
      url: input.idp_url.trim(),
      realm: input.idp_realm.trim(),
      client_id: input.idp_client_id.trim(),
      client_secret: input.idp_client_secret?.trim() || undefined,
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
  const nextIdp: SystemWorkspaceIdpConfig = {
    kind: 'keycloak',
    url: input.idp_url.trim(),
    realm: input.idp_realm.trim(),
    client_id: input.idp_client_id.trim(),
    client_secret: input.idp_client_secret?.trim() || existing.idp.client_secret,
  };
  const requiresRepublish =
    existing.name !== input.name.trim() ||
    existing.workspace_admin !== (workspaceAdmin?.email ?? input.workspace_admin_email.trim()) ||
    existing.workspace_admin_user_id !== workspaceAdmin?.user_id ||
    Boolean(existing.workspace_admin_binding_required) !== !workspaceAdmin ||
    existing.idp.url !== nextIdp.url ||
    existing.idp.realm !== nextIdp.realm ||
    existing.idp.client_id !== nextIdp.client_id ||
    (existing.idp.client_secret || '') !== (nextIdp.client_secret || '');

  return {
    ...existing,
    name: input.name.trim(),
    workspace_admin: workspaceAdmin?.email ?? input.workspace_admin_email.trim(),
    workspace_admin_user_id: workspaceAdmin?.user_id,
    workspace_admin_name: workspaceAdmin?.name ?? null,
    workspace_admin_binding_required: workspaceAdmin ? false : true,
    idp: nextIdp,
    provisioning_status: requiresRepublish ? 'draft' : existing.provisioning_status,
    last_initialized_at: requiresRepublish ? null : existing.last_initialized_at,
    last_init_error: requiresRepublish ? null : existing.last_init_error,
    updated_at: new Date().toISOString(),
  };
}
