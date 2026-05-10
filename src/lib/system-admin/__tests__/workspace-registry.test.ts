import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindPendingWorkspaceAdminByEmail,
  createSystemWorkspace,
  deleteSystemWorkspace,
  disableSystemWorkspace,
  getPublicSystemWorkspace,
  listPublicSystemWorkspaces,
  publishSystemWorkspace,
  updateSystemWorkspace,
} from '../workspace-registry';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  seedPersistedSystemWorkspacesForTest,
} from '../workspace-registry/persistence';
import {
  type WorkspaceStorageLifecycleInput,
  setWorkspaceStorageLifecycleRunnerForTest,
} from '../workspace-storage-lifecycle';

const keycloakDirectoryModule = vi.hoisted(() => ({
  verifyKeycloakLoginIdentityProvider: vi.fn(async () => ({
    idp_ok: true,
  })) as ReturnType<typeof vi.fn>,
  verifyKeycloakIdentityProvider: vi.fn(async () => ({
    idp_ok: true,
    directory_search_supported: true,
  })) as ReturnType<typeof vi.fn>,
  resolveKeycloakUserById: vi.fn(async ({ userId }: { userId: string }) => {
    if (userId === 'kc-admin-001') {
      return { user_id: 'kc-admin-001', email: 'admin@example.com', name: 'Admin Example' };
    }
    if (userId === 'kc-ops-001') {
      return { user_id: 'kc-ops-001', email: 'ops-admin@example.com', name: 'Ops Admin' };
    }
    return { user_id: userId, email: `${userId}@example.com`, name: userId };
  }),
}));

vi.mock('../keycloak-user-directory', () => keycloakDirectoryModule);

describe('system workspace registry', () => {
  const originalEnv = { ...process.env };
  let workspaceStorageLifecycleRunner: ReturnType<typeof vi.fn<(input: WorkspaceStorageLifecycleInput) => Promise<void>>>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-system-ws-'));
    process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH = join(dir, 'provisioning');
    resetSystemWorkspaceRegistryPersistenceForTest();
    workspaceStorageLifecycleRunner = vi.fn(async () => undefined);
    setWorkspaceStorageLifecycleRunnerForTest(async (input) => workspaceStorageLifecycleRunner(input));
  });

  afterEach(() => {
    setWorkspaceStorageLifecycleRunnerForTest(null);
    resetSystemWorkspaceRegistryPersistenceForTest();
    process.env = originalEnv;
  });

  it('creates draft workspaces and only lists ready workspaces publicly', async () => {
    const created = await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_mode: 'directory_user',
      workspace_admin_user_id: 'kc-admin-001',
      workspace_admin_email: 'admin@example.com',
      login_idp_url: 'https://idp.example.com',
      login_idp_realm: 'platform',
      login_client_id: 'agentsmith-platform-login',
      directory_client_id: 'agentsmith-platform-directory',
      directory_client_secret: 'secret-1',
    });

    expect(created.provisioning_status).toBe('draft');
    await expect(listPublicSystemWorkspaces()).resolves.toEqual([]);

    await publishSystemWorkspace('platform_ops');

    await expect(listPublicSystemWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        id: 'platform_ops',
        name: 'Platform Ops',
        workspace_admin: 'admin@example.com',
        workspace_admin_user_id: 'kc-admin-001',
        project_creators: [],
        login_idp: expect.objectContaining({
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'platform',
          client_id: 'agentsmith-platform-login',
        }),
        directory_idp: expect.objectContaining({
          client_id: 'agentsmith-platform-directory',
          has_client_secret: true,
        }),
      }),
    ]);
  });

  it('updates existing workspace configuration', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_mode: 'directory_user',
      workspace_admin_user_id: 'kc-admin-001',
      workspace_admin_email: 'admin@example.com',
      login_idp_url: 'https://idp.example.com',
      login_idp_realm: 'platform',
      login_client_id: 'agentsmith-platform-login',
      directory_client_id: 'agentsmith-platform-directory',
      directory_client_secret: 'secret-1',
    });

    const updated = await updateSystemWorkspace('platform_ops', {
      name: 'Platform Ops',
      workspace_admin_mode: 'directory_user',
      workspace_admin_user_id: 'kc-ops-001',
      workspace_admin_email: 'ops-admin@example.com',
      login_idp_url: 'https://login.example.com',
      login_idp_realm: 'platform-prod',
      login_client_id: 'agentsmith-platform-prod-login',
      directory_client_id: 'agentsmith-platform-prod-directory',
      directory_client_secret: '',
    });

    expect(updated.workspace_admin).toBe('ops-admin@example.com');
    expect(updated.workspace_admin_user_id).toBe('kc-ops-001');
    expect(updated.project_creators).toEqual([]);
    expect(updated.login_idp.url).toBe('https://login.example.com');
    expect(updated.login_idp.realm).toBe('platform-prod');
    expect(updated.directory_idp?.client_secret).toBe('secret-1');
    expect(updated.provisioning_status).toBe('draft');
    expect(updated.last_initialized_at).toBeNull();
    expect(updated.last_init_error).toBeNull();
  });

  it('publishes and disables workspace visibility', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_mode: 'directory_user',
      workspace_admin_user_id: 'kc-admin-001',
      workspace_admin_email: 'admin@example.com',
      login_idp_url: 'https://idp.example.com',
      login_idp_realm: 'platform',
      login_client_id: 'agentsmith-platform-login',
      directory_client_id: 'agentsmith-platform-directory',
      directory_client_secret: 'secret-1',
    });

    const published = await publishSystemWorkspace('platform_ops');
    expect(published.provisioning_status).toBe('ready');
    expect(published.last_initialized_at).toBeTruthy();
    const artifact = JSON.parse(
      readFileSync(join(process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH!, 'platform_ops.json'), 'utf-8'),
    ) as {
      attempt_count: number;
      latest_attempt: {
        attempt_number: number;
        status: string;
        failed_domain: string | null;
      };
      attempts: Array<{
        attempt_number: number;
        status: string;
      }>;
      provisioning_result: { status: string };
      foundation_result: {
        tenant_materialized: boolean;
        data_foundations: {
          domains: Array<{
            domain: string;
            status: string;
            collections: string[];
          }>;
          materialized_collections: string[];
        };
      } | null;
    };
    expect(artifact.attempt_count).toBe(1);
    expect(artifact.latest_attempt).toEqual(
      expect.objectContaining({
        attempt_number: 1,
        status: 'ready',
        failed_domain: null,
      }),
    );
    expect(artifact.attempts).toHaveLength(1);
    expect(artifact.provisioning_result.status).toBe('ready');
    expect(artifact.foundation_result?.tenant_materialized).toBe(true);
    expect(artifact.foundation_result?.data_foundations.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'agent_task',
          status: 'ready',
          collections: expect.arrayContaining(['ws_platform_ops_agent_tasks']),
        }),
      ]),
    );
    expect(artifact.foundation_result?.data_foundations.materialized_collections).toContain(
      'ws_platform_ops_agent_tasks',
    );
    expect(artifact.foundation_result?.data_foundations.materialized_collections).not.toContain(
      'ws_platform_ops_notebook_tasks',
    );
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toEqual(
      expect.objectContaining({ id: 'platform_ops', provisioning_status: 'ready' }),
    );

    const disabled = await disableSystemWorkspace('platform_ops');
    expect(disabled.provisioning_status).toBe('disabled');
    expect(workspaceStorageLifecycleRunner).toHaveBeenCalledWith({
      workspaceId: 'platform_ops',
      reason: 'workspace_disable',
    });
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toBeNull();
  });

  it('requires workspace to be disabled before deletion', async () => {
    await createSystemWorkspace({
      name: 'Delete Guard Workspace',
      workspace_admin_mode: 'directory_user',
      workspace_admin_user_id: 'kc-admin-001',
      workspace_admin_email: 'admin@example.com',
      login_idp_url: 'https://idp.example.com',
      login_idp_realm: 'delete-guard',
      login_client_id: 'agentsmith-delete-guard-login',
      directory_client_id: 'agentsmith-delete-guard-directory',
      directory_client_secret: 'secret-1',
    });

    await expect(deleteSystemWorkspace('delete_guard_workspace')).rejects.toMatchObject({
      code: 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE',
    });
    expect(workspaceStorageLifecycleRunner).not.toHaveBeenCalledWith({
      workspaceId: 'delete_guard_workspace',
      reason: 'workspace_delete',
    });

    await disableSystemWorkspace('delete_guard_workspace');
    await expect(deleteSystemWorkspace('delete_guard_workspace')).resolves.toBeUndefined();
    expect(workspaceStorageLifecycleRunner).toHaveBeenCalledWith({
      workspaceId: 'delete_guard_workspace',
      reason: 'workspace_disable',
    });
    expect(workspaceStorageLifecycleRunner).toHaveBeenCalledWith({
      workspaceId: 'delete_guard_workspace',
      reason: 'workspace_delete',
    });
  });

  it('allows saving workspace admin by pending email when directory search is unavailable', async () => {
    keycloakDirectoryModule.verifyKeycloakIdentityProvider.mockResolvedValueOnce({
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    });

    const created = await createSystemWorkspace({
      name: 'Email Pending Workspace',
      workspace_admin_mode: 'email_pending',
      workspace_admin_email: 'future-admin@example.com',
      login_idp_url: 'https://idp.example.com',
      login_idp_realm: 'pending',
      login_client_id: 'agentsmith-pending-login',
      directory_client_id: 'agentsmith-pending-directory',
      directory_client_secret: 'secret-1',
    });

    expect(created.workspace_admin).toBe('future-admin@example.com');
    expect(created.workspace_admin_user_id).toBeUndefined();
    expect(created.workspace_admin_binding_required).toBe(true);
  });

  it('repairs stale workspace admin binding when email matches but user id changed', async () => {
    seedPersistedSystemWorkspacesForTest([
      {
        id: 'ws_alpha',
        name: 'Alpha Workspace',
        workspace_admin: 'dev-admin@example.com',
        workspace_admin_user_id: 'kc-old-admin',
        workspace_admin_name: 'Dev Admin',
        workspace_admin_binding_required: false,
        project_creators: [],
        login_idp: {
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'alpha',
          client_id: 'agentsmith-alpha',
        },
        directory_idp: {
          client_id: 'agentsmith-alpha',
          client_secret: 'secret-1',
        },
        tenant: {
          workspace_id: 'ws_alpha',
          workspace_name: 'Alpha Workspace',
          substrate_label: 'default',
          database_name: 'agentsmith_ws_alpha',
          collection_prefix: 'ws_alpha_',
          key_prefix: 'ws_alpha:',
        },
        provisioning_status: 'ready',
        last_initialized_at: '2026-03-22T00:00:00.000Z',
        last_init_error: null,
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T00:00:00.000Z',
      },
    ]);

    const updated = await bindPendingWorkspaceAdminByEmail({
      workspaceId: 'ws_alpha',
      user: {
        user_id: 'kc-new-admin',
        email: 'dev-admin@example.com',
        name: 'Dev Admin',
      },
    });

    expect(updated).toEqual(
      expect.objectContaining({
        workspace_admin_user_id: 'kc-new-admin',
        workspace_admin_binding_required: false,
      }),
    );
  });
});
