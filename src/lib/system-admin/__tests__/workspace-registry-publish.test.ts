import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSystemWorkspaceRegistryPersistenceForTest } from '../workspace-registry/persistence';
import { getPersistedSystemWorkspace, upsertPersistedSystemWorkspace } from '../workspace-registry/persistence';

const provisioningModule = vi.hoisted(() => ({
  initializeWorkspaceResources: vi.fn(),
}));

const keycloakDirectoryModule = vi.hoisted(() => ({
  verifyKeycloakLoginIdentityProvider: vi.fn(async () => ({
    idp_ok: true,
  })),
  verifyKeycloakIdentityProvider: vi.fn(async () => ({
    idp_ok: true,
    directory_search_supported: true,
  })),
  resolveKeycloakUserById: vi.fn(async ({ userId }: { userId: string }) => ({
    user_id: userId,
    email: 'admin@example.com',
    name: 'Admin Example',
  })),
}));

vi.mock('../workspace-registry/provisioning', () => provisioningModule);
vi.mock('../keycloak-user-directory', () => keycloakDirectoryModule);

import {
  createSystemWorkspace,
  getSystemWorkspace,
  publishSystemWorkspace,
} from '../workspace-registry';

describe('publishSystemWorkspace retry semantics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    provisioningModule.initializeWorkspaceResources.mockReset();
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
    process.env = originalEnv;
  });

  it('preserves the last successful initialization timestamp when a later publish attempt fails', async () => {
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

    provisioningModule.initializeWorkspaceResources
      .mockResolvedValueOnce({
        status: 'ready',
        initialized_at: '2026-03-13T08:00:00.000Z',
        init_error: null,
      })
      .mockResolvedValueOnce({
        status: 'failed',
        initialized_at: null,
        init_error: 'chat: materialization_failed',
      });

    const firstPublish = await publishSystemWorkspace('platform_ops');
    expect(firstPublish.provisioning_status).toBe('ready');
    expect(firstPublish.last_initialized_at).toBe('2026-03-13T08:00:00.000Z');

    const secondPublish = await publishSystemWorkspace('platform_ops');
    expect(secondPublish.provisioning_status).toBe('failed');
    expect(secondPublish.last_initialized_at).toBe('2026-03-13T08:00:00.000Z');
    expect(secondPublish.last_init_error).toBe('chat: materialization_failed');

    const persisted = await getSystemWorkspace('platform_ops');
    expect(persisted).toEqual(
      expect.objectContaining({
        provisioning_status: 'failed',
        last_initialized_at: '2026-03-13T08:00:00.000Z',
        last_init_error: 'chat: materialization_failed',
      }),
    );
  });

  it('rejects publish when the workspace is already provisioning', async () => {
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

    provisioningModule.initializeWorkspaceResources.mockResolvedValue({
      status: 'ready',
      initialized_at: '2026-03-13T08:00:00.000Z',
      init_error: null,
    });

    const published = await publishSystemWorkspace('platform_ops');
    expect(published.provisioning_status).toBe('ready');

    const persisted = await getPersistedSystemWorkspace('platform_ops');
    await upsertPersistedSystemWorkspace({
      ...(persisted as NonNullable<typeof persisted>),
      provisioning_status: 'provisioning',
    });

    await expect(publishSystemWorkspace('platform_ops')).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_PROVISIONING',
    });
  });
});
