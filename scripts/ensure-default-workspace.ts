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

type TokenResponse = {
  access_token?: string;
};

type KeycloakUserRecord = {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

function resolveKeycloakBaseUrl(): string {
  return requireEnv(
    'INTERNAL_KEYCLOAK_BASE_URL',
    process.env.PUBLIC_KEYCLOAK_BASE_URL || process.env.KEYCLOAK_BASE_URL || 'http://localhost:18080',
  ).replace(/\/+$/, '');
}

function buildDisplayName(user: KeycloakUserRecord): string | null {
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const fullName = [first, last].filter((item) => item.length > 0).join(' ').trim();
  if (fullName) return fullName;
  const username = user.username?.trim();
  return username || null;
}

async function getAdminToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: requireEnv('KEYCLOAK_ADMIN', 'admin'),
      password: requireEnv('KEYCLOAK_ADMIN_PASSWORD', 'admin'),
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`keycloak_admin_token_failed:${response.status}`);
  }
  const payload = (await response.json()) as TokenResponse;
  const token = payload.access_token?.trim();
  if (!token) {
    throw new Error('keycloak_admin_token_missing');
  }
  return token;
}

async function fetchUsers(
  baseUrl: string,
  realm: string,
  token: string,
  searchParams: URLSearchParams,
): Promise<KeycloakUserRecord[]> {
  const response = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/users?${searchParams.toString()}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    throw new Error(`keycloak_user_search_failed:${response.status}`);
  }
  const payload = (await response.json()) as KeycloakUserRecord[];
  return Array.isArray(payload) ? payload : [];
}

function toIdentitySnapshot(user: KeycloakUserRecord, expectedEmail?: string): WorkspaceIdentitySnapshot | null {
  const userId = user.id?.trim();
  const email = user.email?.trim();
  if (!userId || !email) return null;
  if (expectedEmail && email.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    return null;
  }
  return {
    user_id: userId,
    email,
    name: buildDisplayName(user),
  };
}

async function resolveUserByUsernameOrEmail(args: {
  baseUrl: string;
  realm: string;
  token: string;
  username: string;
  email: string;
}): Promise<WorkspaceIdentitySnapshot> {
  const byUsername = await fetchUsers(
    args.baseUrl,
    args.realm,
    args.token,
    new URLSearchParams({
      username: args.username,
      exact: 'true',
      max: '1',
    }),
  );
  const exactUsername = byUsername
    .map((item) => toIdentitySnapshot(item, args.email))
    .find((item) => item !== null);
  if (exactUsername) {
    return exactUsername;
  }

  const byEmail = await fetchUsers(
    args.baseUrl,
    args.realm,
    args.token,
    new URLSearchParams({
      email: args.email,
      exact: 'true',
      max: '1',
    }),
  );
  const exactEmail = byEmail
    .map((item) => toIdentitySnapshot(item, args.email))
    .find((item) => item !== null);
  if (exactEmail) {
    return exactEmail;
  }

  throw new Error(`keycloak_seed_user_not_found:${args.username}`);
}

async function main() {
  const workspaceId = requireEnv('MBOS_DEFAULT_WORKSPACE_ID', 'ws_default');
  const workspaceName = requireEnv('MBOS_DEFAULT_WORKSPACE_NAME', 'Default Workspace');
  const keycloakBaseUrl = requireEnv('PUBLIC_KEYCLOAK_BASE_URL', process.env.KEYCLOAK_BASE_URL || 'http://localhost:18080');
  const keycloakRealm = requireEnv('KEYCLOAK_REALM', 'mbos');
  const clientId = requireEnv('KEYCLOAK_CLIENT_ID', 'agentsmith');
  const keycloakAdminBaseUrl = resolveKeycloakBaseUrl();
  const adminToken = await getAdminToken(keycloakAdminBaseUrl);
  const workspaceAdminEmail = requireEnv('MBOS_DEFAULT_WORKSPACE_ADMIN_EMAIL', 'dev-admin@example.com');
  const workspaceAdminUsername = requireEnv('INTEGRATION_DEV_ADMIN_USERNAME', 'dev-admin');
  const workspaceAdminName = process.env.MBOS_DEFAULT_WORKSPACE_ADMIN_NAME?.trim() || 'Dev Admin';
  const workspaceAdmin = await resolveUserByUsernameOrEmail({
    baseUrl: keycloakAdminBaseUrl,
    realm: keycloakRealm,
    token: adminToken,
    username: workspaceAdminUsername,
    email: workspaceAdminEmail,
  });
  const integrationUser = await resolveUserByUsernameOrEmail({
    baseUrl: keycloakAdminBaseUrl,
    realm: keycloakRealm,
    token: adminToken,
    username: requireEnv('INTEGRATION_USER_USERNAME', 'integration-user'),
    email: requireEnv('MBOS_INTEGRATION_USER_EMAIL', 'integration-user@example.com'),
  });
  const projectCreators: WorkspaceIdentitySnapshot[] = [
    workspaceAdmin,
    integrationUser,
  ];
  const timestamp = nowIso();
  const record: SystemWorkspaceRecord = {
    id: workspaceId,
    name: workspaceName,
    workspace_admin: workspaceAdminEmail,
    workspace_admin_user_id: workspaceAdmin.user_id,
    workspace_admin_name: workspaceAdmin.name ?? workspaceAdminName,
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
