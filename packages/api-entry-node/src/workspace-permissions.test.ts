import { afterEach, describe, expect, it, vi } from 'vitest';

const registryModule = vi.hoisted(() => ({
  readRegisteredWorkspaces: vi.fn(),
}));

vi.mock('./workspace-registry.js', () => registryModule);

import {
  buildWorkspaceRecords,
  OWNER_PROJECT_PERMISSIONS,
  PROJECT_ADMIN_PROJECT_PERMISSIONS,
} from './workspace-permissions.js';

describe('buildWorkspaceRecords', () => {
  const envBackup = {
    MBOS_DEFAULT_WORKSPACE_ID: process.env.MBOS_DEFAULT_WORKSPACE_ID,
    MBOS_DEFAULT_WORKSPACE_NAME: process.env.MBOS_DEFAULT_WORKSPACE_NAME,
  };

  afterEach(() => {
    process.env.MBOS_DEFAULT_WORKSPACE_ID = envBackup.MBOS_DEFAULT_WORKSPACE_ID;
    process.env.MBOS_DEFAULT_WORKSPACE_NAME = envBackup.MBOS_DEFAULT_WORKSPACE_NAME;
    registryModule.readRegisteredWorkspaces.mockReset();
  });

  it('includes default workspace and registered workspaces', async () => {
    process.env.MBOS_DEFAULT_WORKSPACE_ID = 'ws_default';
    process.env.MBOS_DEFAULT_WORKSPACE_NAME = 'Default Workspace';
    registryModule.readRegisteredWorkspaces.mockResolvedValue([
      {
        id: 'ws_alpha',
        name: 'Alpha Workspace',
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);

    const records = await buildWorkspaceRecords();

    expect(records.map((item) => item.id)).toEqual(['ws_default', 'ws_alpha']);
    expect(records.find((item) => item.id === 'ws_alpha')).toMatchObject({
      name: 'Alpha Workspace',
    });
  });

  it('lets registered workspaces override the default workspace record', async () => {
    process.env.MBOS_DEFAULT_WORKSPACE_ID = 'ws_default';
    process.env.MBOS_DEFAULT_WORKSPACE_NAME = 'Default Workspace';
    registryModule.readRegisteredWorkspaces.mockResolvedValue([
      {
        id: 'ws_default',
        name: 'Configured Default Workspace',
        created_at: '2026-03-11T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);

    const records = await buildWorkspaceRecords();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'ws_default',
      name: 'Configured Default Workspace',
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });
  });

  it('grants project:files:update to owner and project admin built-in permission sets', () => {
    expect(OWNER_PROJECT_PERMISSIONS).toContain('project:files:update');
    expect(PROJECT_ADMIN_PROJECT_PERMISSIONS).toContain('project:files:update');
  });

});
