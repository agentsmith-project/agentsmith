import { initializeWorkspaceResources } from './workspace-registry/provisioning';
import { resolveKeycloakUserById } from './keycloak-user-directory';
import {
  buildUpdatedWorkspaceRecord,
  createWorkspaceRecord,
  readRegistryFile,
  sanitizeRecord,
  writeRegistryFile,
} from './workspace-registry/storage';
export type {
  PublicSystemWorkspaceRecord,
  PublishSystemWorkspaceResult,
  SystemWorkspaceIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceProvisioningStatus,
} from './workspace-registry/types';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
} from './workspace-registry/types';

export async function listSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const records = await readRegistryFile();
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listPublicSystemWorkspaces(): Promise<PublicSystemWorkspaceRecord[]> {
  const records = await listSystemWorkspaces();
  return records.filter((record) => record.provisioning_status === 'ready').map(sanitizeRecord);
}

export async function getSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const records = await readRegistryFile();
  return records.find((record) => record.id === id) ?? null;
}

export async function getPublicSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const record = await getSystemWorkspace(id);
  if (!record || record.provisioning_status !== 'ready') {
    return null;
  }
  return record;
}

export async function createSystemWorkspace(input: UpsertSystemWorkspaceInput): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const workspaceAdmin = await resolveKeycloakUserById({
    idpUrl: input.idp_url,
    realm: input.idp_realm,
    userId: input.workspace_admin_user_id,
  });
  const record = createWorkspaceRecord(records, input, workspaceAdmin);
  await writeRegistryFile([...records, record]);
  return record;
}

export async function updateSystemWorkspace(
  id: string,
  input: UpsertSystemWorkspaceInput,
): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const workspaceAdmin = await resolveKeycloakUserById({
    idpUrl: input.idp_url,
    realm: input.idp_realm,
    userId: input.workspace_admin_user_id,
  });
  const updated = buildUpdatedWorkspaceRecord(existing, input, workspaceAdmin);
  await writeRegistryFile(records.map((record) => (record.id === id ? updated : record)));
  return updated;
}

export async function publishSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
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
  await writeRegistryFile(records.map((record) => (record.id === id ? provisioningRecord : record)));

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
  await writeRegistryFile(records.map((record) => (record.id === id ? finalized : record)));
  return finalized;
}

export async function disableSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const updated: SystemWorkspaceRecord = {
    ...existing,
    provisioning_status: 'disabled',
    updated_at: new Date().toISOString(),
  };
  await writeRegistryFile(records.map((record) => (record.id === id ? updated : record)));
  return updated;
}

export async function deleteSystemWorkspace(id: string): Promise<void> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  if (existing.provisioning_status !== 'disabled') {
    throw Object.assign(new Error('workspace_disable_required_before_delete'), {
      code: 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE',
    });
  }
  const nextRecords = records.filter((record) => record.id !== id);
  await writeRegistryFile(nextRecords);
}
