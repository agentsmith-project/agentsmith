import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSystemWorkspace,
  deleteSystemWorkspace,
  disableSystemWorkspace,
  getPublicSystemWorkspace,
  listPublicSystemWorkspaces,
  publishSystemWorkspace,
  updateSystemWorkspace,
} from '../workspace-registry';
import { resetSystemWorkspaceRegistryPersistenceForTest } from '../workspace-registry/persistence';

const keycloakDirectoryModule = vi.hoisted(() => ({
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

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-system-ws-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
    process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH = join(dir, 'provisioning');
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
    process.env = originalEnv;
  });

  it('creates draft workspaces and only lists ready workspaces publicly', async () => {
    const created = await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
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
        idp: expect.objectContaining({
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'platform',
          client_id: 'agentsmith-platform',
          has_client_secret: true,
        }),
      }),
    ]);
  });

  it('updates existing workspace configuration', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    const updated = await updateSystemWorkspace('platform_ops', {
      name: 'Platform Ops',
      workspace_admin_user_id: 'kc-ops-001',
      idp_url: 'https://login.example.com',
      idp_realm: 'platform-prod',
      idp_client_id: 'agentsmith-platform-prod',
      idp_client_secret: '',
    });

    expect(updated.workspace_admin).toBe('ops-admin@example.com');
    expect(updated.workspace_admin_user_id).toBe('kc-ops-001');
    expect(updated.project_creators).toEqual([]);
    expect(updated.idp.url).toBe('https://login.example.com');
    expect(updated.idp.realm).toBe('platform-prod');
    expect(updated.idp.client_secret).toBe('secret-1');
    expect(updated.provisioning_status).toBe('draft');
    expect(updated.last_initialized_at).toBeNull();
    expect(updated.last_init_error).toBeNull();
  });

  it('publishes and disables workspace visibility', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
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
          domain: 'notebook',
          status: 'ready',
          collections: expect.arrayContaining(['ws_platform_ops_notebook_tasks']),
        }),
      ]),
    );
    expect(artifact.foundation_result?.data_foundations.materialized_collections).toContain(
      'ws_platform_ops_notebook_tasks',
    );
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toEqual(
      expect.objectContaining({ id: 'platform_ops', provisioning_status: 'ready' }),
    );

    const disabled = await disableSystemWorkspace('platform_ops');
    expect(disabled.provisioning_status).toBe('disabled');
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toBeNull();
  });

  it('marks workspace as failed when foundation initialization preconditions are incomplete', async () => {
    await createSystemWorkspace({
      name: 'Broken Workspace',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: '',
      idp_realm: 'broken',
      idp_client_id: 'agentsmith-broken',
      idp_client_secret: 'secret-1',
    });

    const published = await publishSystemWorkspace('broken_workspace');
    expect(published.provisioning_status).toBe('failed');
    expect(published.last_initialized_at).toBeNull();
    expect(published.last_init_error).toBe('identity_provider_config_incomplete');

    const artifact = JSON.parse(
      readFileSync(join(process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH!, 'broken_workspace.json'), 'utf-8'),
    ) as {
      attempt_count: number;
      latest_attempt: {
        attempt_number: number;
        status: string;
        init_error: string | null;
      };
      attempts: Array<{
        attempt_number: number;
        status: string;
      }>;
      provisioning_result: { status: string; init_error: string | null };
      foundation_result: unknown;
    };
    expect(artifact.attempt_count).toBe(1);
    expect(artifact.latest_attempt).toEqual(
      expect.objectContaining({
        attempt_number: 1,
        status: 'failed',
        init_error: 'identity_provider_config_incomplete',
      }),
    );
    expect(artifact.attempts).toHaveLength(1);
    expect(artifact.provisioning_result).toEqual({
      status: 'failed',
      initialized_at: null,
      init_error: 'identity_provider_config_incomplete',
    });
    expect(artifact.foundation_result).toBeNull();
    await expect(getPublicSystemWorkspace('broken_workspace')).resolves.toBeNull();
  });

  it('appends provisioning attempt history across retries', async () => {
    await createSystemWorkspace({
      name: 'Retry Workspace',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: '',
      idp_realm: 'retry',
      idp_client_id: 'agentsmith-retry',
      idp_client_secret: 'secret-1',
    });

    const firstPublish = await publishSystemWorkspace('retry_workspace');
    expect(firstPublish.provisioning_status).toBe('failed');

    await updateSystemWorkspace('retry_workspace', {
      name: 'Retry Workspace',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: 'https://idp.example.com',
      idp_realm: 'retry',
      idp_client_id: 'agentsmith-retry',
      idp_client_secret: 'secret-1',
    });

    const secondPublish = await publishSystemWorkspace('retry_workspace');
    expect(secondPublish.provisioning_status).toBe('ready');

    const artifact = JSON.parse(
      readFileSync(join(process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH!, 'retry_workspace.json'), 'utf-8'),
    ) as {
      attempt_count: number;
      latest_attempt: {
        attempt_number: number;
        status: string;
      };
      attempts: Array<{
        attempt_number: number;
        status: string;
        init_error: string | null;
      }>;
    };

    expect(artifact.attempt_count).toBe(2);
    expect(artifact.latest_attempt).toEqual(
      expect.objectContaining({
        attempt_number: 2,
        status: 'ready',
      }),
    );
    expect(artifact.attempts).toEqual([
      expect.objectContaining({
        attempt_number: 1,
        status: 'failed',
        init_error: 'identity_provider_config_incomplete',
      }),
      expect.objectContaining({
        attempt_number: 2,
        status: 'ready',
        init_error: null,
      }),
    ]);
  });

  it('requires workspace to be disabled before deletion', async () => {
    await createSystemWorkspace({
      name: 'Delete Guard Workspace',
      workspace_admin_user_id: 'kc-admin-001',
      idp_url: 'https://idp.example.com',
      idp_realm: 'delete-guard',
      idp_client_id: 'agentsmith-delete-guard',
      idp_client_secret: 'secret-1',
    });

    await expect(deleteSystemWorkspace('delete_guard_workspace')).rejects.toMatchObject({
      code: 'WORKSPACE_DISABLE_REQUIRED_BEFORE_DELETE',
    });

    await disableSystemWorkspace('delete_guard_workspace');
    await expect(deleteSystemWorkspace('delete_guard_workspace')).resolves.toBeUndefined();
  });

  it('imports legacy registry file records into the persisted registry on first read', async () => {
    const registryPath = process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!;
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        registryPath,
        `${JSON.stringify([
          {
            id: 'legacy_ws',
            name: 'Legacy Workspace',
            workspace_admin: 'admin@example.com',
            workspace_admin_user_id: 'kc-admin-001',
            workspace_admin_name: 'Admin Example',
            project_creators: [],
            idp: {
              kind: 'keycloak',
              url: 'https://idp.example.com',
              realm: 'legacy',
              client_id: 'agentsmith-legacy',
            },
            tenant: {
              substrate_label: 'legacy',
              database_name: 'agentsmith_legacy_ws',
              collection_prefix: 'ws_legacy_',
              key_prefix: 'ws_legacy:',
            },
            provisioning_status: 'ready',
            last_initialized_at: '2026-03-18T00:00:00.000Z',
            last_init_error: null,
            created_at: '2026-03-18T00:00:00.000Z',
            updated_at: '2026-03-18T00:00:00.000Z',
          },
        ], null, 2)}\n`,
      ),
    );

    const items = await listPublicSystemWorkspaces();
    expect(items).toEqual([
      expect.objectContaining({
        id: 'legacy_ws',
        name: 'Legacy Workspace',
      }),
    ]);

    const loaded = await getPublicSystemWorkspace('legacy_ws');
    expect(loaded).toEqual(expect.objectContaining({ id: 'legacy_ws' }));
  });
});
