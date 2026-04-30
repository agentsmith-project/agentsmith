import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPersistedSystemWorkspace,
  upsertPersistedSystemWorkspace,
  resetSystemWorkspaceRegistryPersistenceForTest,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import {
  getRegisteredWorkspaceConfig,
  listRegisteredWorkspaceIds,
  readRegisteredWorkspaces,
  updateRegisteredWorkspaceProjectCreators,
} from './workspace-registry.js';

describe('readRegisteredWorkspaces', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  it('returns ready registered workspaces and skips disabled ones', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_ready',
      name: 'Ready Workspace',
      workspace_admin: 'ready@example.com',
      project_creators: [],
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_ready',
        workspace_name: 'Ready Workspace',
        substrate_label: 'default',
        database_name: 'agentsmith_ws_ready',
        collection_prefix: 'ws_ready_',
        key_prefix: 'ws_ready:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-12T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });
    await upsertPersistedSystemWorkspace({
      id: 'ws_disabled',
      name: 'Disabled Workspace',
      workspace_admin: 'disabled@example.com',
      project_creators: [],
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_disabled',
        workspace_name: 'Disabled Workspace',
        substrate_label: 'default',
        database_name: 'agentsmith_ws_disabled',
        collection_prefix: 'ws_disabled_',
        key_prefix: 'ws_disabled:',
      },
      provisioning_status: 'disabled',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-11T00:00:00.000Z',
    });

    await expect(readRegisteredWorkspaces()).resolves.toEqual([
      {
        id: 'ws_ready',
        name: 'Ready Workspace',
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);
    await expect(listRegisteredWorkspaceIds()).resolves.toContain('ws_default');
  });

  it('preserves published login configuration when project creators are updated', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_ready',
      name: 'Ready Workspace',
      provisioning_status: 'ready',
      workspace_admin: 'owner@example.com',
      project_creators: [{
        user_id: 'creator@example.com',
        email: 'creator@example.com',
        name: 'creator@example.com',
      }],
      login_idp: {
        kind: 'keycloak',
        url: 'http://localhost:18080',
        realm: 'mbos',
        client_id: 'agentsmith',
        client_secret: 'secret',
      },
      tenant: {
        workspace_id: 'ws_ready',
        workspace_name: 'Ready Workspace',
        substrate_label: 'default',
        database_name: 'agentsmith_ws_ready',
        collection_prefix: 'ws_ready_',
        key_prefix: 'ws_ready:',
      },
      last_initialized_at: '2026-03-12T00:00:00.000Z',
      last_init_error: null,
      created_at: '2026-03-12T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });

    await updateRegisteredWorkspaceProjectCreators('ws_ready', [
      {
        user_id: 'next-user',
        email: 'next@example.com',
        name: 'Next Creator',
      },
    ]);

    await expect(getRegisteredWorkspaceConfig('ws_ready')).resolves.toEqual(
      expect.objectContaining({
        project_creators: [
          {
            user_id: 'next-user',
            email: 'next@example.com',
            name: 'Next Creator',
          },
        ],
        login_idp: expect.objectContaining({
          kind: 'keycloak',
          url: 'http://localhost:18080',
          realm: 'mbos',
          client_id: 'agentsmith',
          client_secret: 'secret',
        }),
        provisioning_status: 'ready',
        last_initialized_at: '2026-03-12T00:00:00.000Z',
        last_init_error: null,
      }),
    );
    await expect(getPersistedSystemWorkspace('ws_ready')).resolves.toEqual(
      expect.objectContaining({
        id: 'ws_ready',
        project_creators: [
          {
            user_id: 'next-user',
            email: 'next@example.com',
            name: 'Next Creator',
          },
        ],
      }),
    );
  });
});
