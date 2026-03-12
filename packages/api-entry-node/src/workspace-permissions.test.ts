import { afterEach, describe, expect, it, vi } from 'vitest';

const registryModule = vi.hoisted(() => ({
  readRegisteredWorkspaces: vi.fn(),
}));

vi.mock('./workspace-registry.js', () => registryModule);

import { buildWorkspaceRecords } from './workspace-permissions.js';

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

  it('includes default workspace and registered workspaces', () => {
    process.env.MBOS_DEFAULT_WORKSPACE_ID = 'ws_default';
    process.env.MBOS_DEFAULT_WORKSPACE_NAME = 'Default Workspace';
    registryModule.readRegisteredWorkspaces.mockReturnValue([
      {
        id: 'ws_alpha',
        name: 'Alpha Workspace',
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);

    const records = buildWorkspaceRecords();

    expect(records.map((item) => item.id)).toEqual(['ws_default', 'ws_alpha']);
    expect(records.find((item) => item.id === 'ws_alpha')).toMatchObject({
      name: 'Alpha Workspace',
    });
  });

  it('lets registered workspaces override the default workspace record', () => {
    process.env.MBOS_DEFAULT_WORKSPACE_ID = 'ws_default';
    process.env.MBOS_DEFAULT_WORKSPACE_NAME = 'Default Workspace';
    registryModule.readRegisteredWorkspaces.mockReturnValue([
      {
        id: 'ws_default',
        name: 'Configured Default Workspace',
        created_at: '2026-03-11T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);

    const records = buildWorkspaceRecords();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'ws_default',
      name: 'Configured Default Workspace',
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });
  });
});
