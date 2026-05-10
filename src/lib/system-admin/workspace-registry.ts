import { initializeWorkspaceResources } from './workspace-registry/provisioning';
import {
  resolveKeycloakUserById,
  verifyKeycloakIdentityProvider,
  verifyKeycloakLoginIdentityProvider,
} from './keycloak-user-directory';
import {
  buildUpdatedWorkspaceRecord,
  createWorkspaceRecord,
  sanitizeRecord,
} from './workspace-registry/storage';
import {
  deletePersistedSystemWorkspace,
  getPersistedSystemWorkspace,
  listPersistedSystemWorkspaces,
  upsertPersistedSystemWorkspace,
} from './workspace-registry/persistence';
import { runWorkspaceStorageLifecycleTeardown } from './workspace-storage-lifecycle';
export type {
  PublicSystemWorkspaceRecord,
  PublishSystemWorkspaceResult,
  SystemWorkspaceDirectoryIdpConfig,
  SystemWorkspaceLoginIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceProvisioningStatus,
} from './workspace-registry/types';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceIdentitySnapshot,
} from './workspace-registry/types';

export async function listSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const records = await listPersistedSystemWorkspaces();
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listPublicSystemWorkspaces(): Promise<PublicSystemWorkspaceRecord[]> {
  const records = await listSystemWorkspaces();
  return records.filter((record) => record.provisioning_status === 'ready').map(sanitizeRecord);
}

export async function getSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  return getPersistedSystemWorkspace(id);
}

export async function getPublicSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const record = await getSystemWorkspace(id);
  if (!record || record.provisioning_status !== 'ready') {
    return null;
  }
  return record;
}

export async function createSystemWorkspace(input: UpsertSystemWorkspaceInput): Promise<SystemWorkspaceRecord> {
  const records = await listPersistedSystemWorkspaces();
  const effectiveDirectoryClientId = input.directory_client_id?.trim() || (input.directory_client_secret?.trim() ? input.login_client_id.trim() : '');
  const loginVerification = await verifyKeycloakLoginIdentityProvider({
    idpUrl: input.login_idp_url,
    realm: input.login_idp_realm,
  });
  if (!loginVerification.idp_ok) {
    throw Object.assign(new Error('keycloak_idp_invalid'), { code: 'KEYCLOAK_IDP_INVALID' });
  }
  const directoryVerification = await verifyKeycloakIdentityProvider({
    idpUrl: input.login_idp_url,
    realm: input.login_idp_realm,
    clientId: effectiveDirectoryClientId,
    clientSecret: input.directory_client_secret,
  });
  if (input.workspace_admin_mode === 'directory_user' && !directoryVerification.directory_search_supported) {
    throw Object.assign(new Error('keycloak_directory_permission_required'), {
      code: 'KEYCLOAK_DIRECTORY_PERMISSION_REQUIRED',
    });
  }
  const workspaceAdmin = input.workspace_admin_mode === 'directory_user'
    ? await resolveKeycloakUserById({
        idpUrl: input.login_idp_url,
        realm: input.login_idp_realm,
        clientId: effectiveDirectoryClientId,
        clientSecret: input.directory_client_secret,
        userId: input.workspace_admin_user_id ?? '',
      })
    : null;
  const record = createWorkspaceRecord(records, input, workspaceAdmin);
  await upsertPersistedSystemWorkspace(record);
  return record;
}

export async function updateSystemWorkspace(
  id: string,
  input: UpsertSystemWorkspaceInput,
): Promise<SystemWorkspaceRecord> {
  const records = await listPersistedSystemWorkspaces();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const effectiveDirectoryClientId = input.directory_client_id?.trim() || (
    input.directory_client_secret?.trim()
      ? input.login_client_id.trim()
      : (existing.directory_idp?.client_id?.trim() || '')
  );
  const loginVerification = await verifyKeycloakLoginIdentityProvider({
    idpUrl: input.login_idp_url,
    realm: input.login_idp_realm,
  });
  if (!loginVerification.idp_ok) {
    throw Object.assign(new Error('keycloak_idp_invalid'), { code: 'KEYCLOAK_IDP_INVALID' });
  }
  const directoryVerification = await verifyKeycloakIdentityProvider({
    idpUrl: input.login_idp_url,
    realm: input.login_idp_realm,
    clientId: effectiveDirectoryClientId,
    clientSecret: input.directory_client_secret || existing.directory_idp?.client_secret,
  });
  if (input.workspace_admin_mode === 'directory_user' && !directoryVerification.directory_search_supported) {
    throw Object.assign(new Error('keycloak_directory_permission_required'), {
      code: 'KEYCLOAK_DIRECTORY_PERMISSION_REQUIRED',
    });
  }
  const workspaceAdmin = input.workspace_admin_mode === 'directory_user'
    ? await resolveKeycloakUserById({
        idpUrl: input.login_idp_url,
        realm: input.login_idp_realm,
        clientId: effectiveDirectoryClientId,
        clientSecret: input.directory_client_secret || existing.directory_idp?.client_secret,
        userId: input.workspace_admin_user_id ?? '',
      })
    : null;
  const updated = buildUpdatedWorkspaceRecord(existing, input, workspaceAdmin);
  await upsertPersistedSystemWorkspace(updated);
  return updated;
}

export async function publishSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await listPersistedSystemWorkspaces();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  if (existing.provisioning_status === 'provisioning') {
    throw Object.assign(new Error('workspace_already_provisioning'), { code: 'WORKSPACE_ALREADY_PROVISIONING' });
  }

  const provisioningRecord: SystemWorkspaceRecord = {
    ...existing,
    provisioning_status: 'provisioning',
    last_init_error: null,
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(provisioningRecord);

  const result = await initializeWorkspaceResources(provisioningRecord);
  const finalized: SystemWorkspaceRecord = {
    ...provisioningRecord,
    provisioning_status: result.status,
    last_initialized_at:
      result.status === 'ready'
        ? result.initialized_at
        : (existing.last_initialized_at ?? null),
    last_init_error: result.init_error,
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(finalized);
  return finalized;
}

export async function disableSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await listPersistedSystemWorkspaces();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  await runWorkspaceStorageLifecycleTeardown({
    workspaceId: id,
    reason: 'workspace_disable',
  });
  const updated: SystemWorkspaceRecord = {
    ...existing,
    provisioning_status: 'disabled',
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(updated);
  return updated;
}

export async function deleteSystemWorkspace(id: string): Promise<void> {
  const records = await listPersistedSystemWorkspaces();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  if (existing.provisioning_status !== 'disabled') {
    throw Object.assign(new Error('workspace_disable_required_before_delete'), {
      code: 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE',
    });
  }
  await runWorkspaceStorageLifecycleTeardown({
    workspaceId: id,
    reason: 'workspace_delete',
  });
  await deletePersistedSystemWorkspace(id);
}

export async function bindPendingWorkspaceAdminByEmail(args: {
  workspaceId: string;
  user: WorkspaceIdentitySnapshot;
}): Promise<SystemWorkspaceRecord | null> {
  const existing = await getPersistedSystemWorkspace(args.workspaceId);
  if (!existing) {
    return existing;
  }
  if (existing.workspace_admin.trim().toLowerCase() !== args.user.email.trim().toLowerCase()) {
    return existing;
  }
  if (
    !existing.workspace_admin_binding_required
    && existing.workspace_admin_user_id === args.user.user_id
  ) {
    return existing;
  }

  const updated: SystemWorkspaceRecord = {
    ...existing,
    workspace_admin: args.user.email,
    workspace_admin_user_id: args.user.user_id,
    workspace_admin_name: args.user.name ?? null,
    workspace_admin_binding_required: false,
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(updated);
  return updated;
}
