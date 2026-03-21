#!/usr/bin/env tsx
/* eslint-disable no-console */
import {
  disposeSystemWorkspaceRegistryPersistence,
  upsertPersistedSystemWorkspace,
} from '../src/lib/system-admin/workspace-registry/persistence';
import type { SystemWorkspaceRecord, WorkspaceIdentitySnapshot } from '../src/lib/system-admin/workspace-registry/types';

function nowIso(): string {
  return new Date().toISOString();
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    throw new Error(`missing_env_${name}`);
  }
  return value;
}

async function main() {
  const workspaceId = requireEnv('MBOS_DEFAULT_WORKSPACE_ID', 'ws_default');
  const workspaceName = requireEnv('MBOS_DEFAULT_WORKSPACE_NAME', 'Default Workspace');
  const keycloakBaseUrl = requireEnv('PUBLIC_KEYCLOAK_BASE_URL', process.env.KEYCLOAK_BASE_URL || 'http://localhost:18080');
  const keycloakRealm = requireEnv('KEYCLOAK_REALM', 'mbos');
  const clientId = requireEnv('KEYCLOAK_CLIENT_ID', 'agentsmith');
  const workspaceAdminEmail = requireEnv('MBOS_DEFAULT_WORKSPACE_ADMIN_EMAIL', 'dev-admin@example.com');
  const workspaceAdminUserId = requireEnv('MBOS_DEFAULT_WORKSPACE_ADMIN_USER_ID', 'ba7a0e64-5fae-4fe2-ada6-453d23a2eb0e');
  const workspaceAdminName = process.env.MBOS_DEFAULT_WORKSPACE_ADMIN_NAME?.trim() || 'Dev Admin';
  const projectCreators: WorkspaceIdentitySnapshot[] = [
    { user_id: workspaceAdminUserId, email: workspaceAdminEmail, name: workspaceAdminName },
    {
      user_id: requireEnv('MBOS_INTEGRATION_USER_ID', 'ced1e80e-4f06-4194-8f57-7bc055a62ae0'),
      email: requireEnv('MBOS_INTEGRATION_USER_EMAIL', 'integration-user@example.com'),
      name: process.env.MBOS_INTEGRATION_USER_NAME?.trim() || 'Integration User',
    },
  ];
  const timestamp = nowIso();
  const record: SystemWorkspaceRecord = {
    id: workspaceId,
    name: workspaceName,
    workspace_admin: workspaceAdminEmail,
    workspace_admin_user_id: workspaceAdminUserId,
    workspace_admin_name: workspaceAdminName,
    workspace_admin_binding_required: false,
    project_creators: projectCreators,
    login_idp: {
      kind: 'keycloak',
      url: keycloakBaseUrl,
      realm: keycloakRealm,
      client_id: clientId,
    },
    directory_idp: {
      client_id: clientId,
    },
    tenant: {
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      substrate_label: process.env.MBOS_DEFAULT_SUBSTRATE_LABEL?.trim() || 'default',
      database_name: process.env.MBOS_DEFAULT_WORKSPACE_DB?.trim() || `agentsmith_${workspaceId}`,
      collection_prefix: process.env.MBOS_DEFAULT_COLLECTION_PREFIX?.trim() || `${workspaceId}_`,
      key_prefix: process.env.MBOS_DEFAULT_KEY_PREFIX?.trim() || `${workspaceId}:`,
    },
    provisioning_status: 'ready',
    last_initialized_at: timestamp,
    last_init_error: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await upsertPersistedSystemWorkspace(record);
  process.stdout.write(`[ensure-default-workspace] ensured ${workspaceId}\n`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ensure-default-workspace] failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disposeSystemWorkspaceRegistryPersistence();
  });
