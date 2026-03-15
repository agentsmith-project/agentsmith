import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeProjectAuditEvent,
  getRegisteredWorkspaceConfig,
  updateRegisteredWorkspaceProjectCreators,
  buildWorkspaceMembersFromConfig,
  resolveWorkspacePermissions,
  resolveKeycloakDirectoryUsersByIds,
} = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
  getRegisteredWorkspaceConfig: vi.fn(),
  updateRegisteredWorkspaceProjectCreators: vi.fn(),
  buildWorkspaceMembersFromConfig: vi.fn(),
  resolveWorkspacePermissions: vi.fn(),
  resolveKeycloakDirectoryUsersByIds: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
}));

vi.mock('./workspace-registry.js', () => ({
  getRegisteredWorkspaceConfig,
  updateRegisteredWorkspaceProjectCreators,
}));

vi.mock('./workspace-permissions.js', () => ({
  buildWorkspaceMembersFromConfig,
  resolveWorkspacePermissions,
}));

vi.mock('./keycloak-user-directory.js', () => ({
  resolveKeycloakDirectoryUsersByIds,
  searchKeycloakDirectoryUsers: vi.fn(),
}));

import { handleWorkspaceProjectCreatorsRoute } from './project-source-workspace-governance.js';

describe('project-source-workspace-governance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    resolveWorkspacePermissions.mockReturnValue(['workspace:governance:update']);
    getRegisteredWorkspaceConfig.mockReturnValue({
      id: 'ws-1',
      name: 'Workspace One',
      idp: {
        url: 'http://localhost:18080',
        realm: 'mbos',
      },
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    });
  });

  it('lists non-admin workspace project creators', async () => {
    buildWorkspaceMembersFromConfig.mockReturnValue([
      {
        user_id: 'creator-1',
        name: 'Creator One',
        email: 'creator-1@example.com',
        permissions: ['workspace:project:create'],
      },
      {
        user_id: 'admin-1',
        name: 'Admin One',
        email: 'admin-1@example.com',
        permissions: ['workspace:project:create', 'workspace:governance:update'],
      },
    ]);
    const json = vi.fn();
    const res = {} as never;

    await expect(handleWorkspaceProjectCreatorsRoute({
      method: 'GET',
      req: { headers: {} } as never,
      res,
      deps: {} as never,
      user: { id: 'admin-1', email: 'admin-1@example.com', name: 'Admin One' },
      workspaces: [{ id: 'ws-1', created_at: '2026-03-01T00:00:00Z' }],
      workspaceId: 'ws-1',
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(res, 200, {
      items: [{
        id: 'creator-1',
        user_id: 'creator-1',
        name: 'Creator One',
        email: 'creator-1@example.com',
      }],
      total: 1,
    });
  });

  it('updates workspace project creators and records audit metadata', async () => {
    buildWorkspaceMembersFromConfig.mockReturnValue([
      {
        user_id: 'creator-old',
        name: 'Old Creator',
        email: 'creator-old@example.com',
        permissions: ['workspace:project:create'],
      },
    ]);
    const json = vi.fn();
    const res = {} as never;
    const readBody = vi.fn().mockResolvedValue({
      project_creator_user_ids: [' creator-new ', 'creator-new', 'creator-two@example.com', '', 1],
    });
    resolveKeycloakDirectoryUsersByIds.mockResolvedValue([
      {
        user_id: 'creator-new',
        email: 'creator-new@example.com',
        name: 'Creator New',
      },
      {
        user_id: 'creator-two@example.com',
        email: 'creator-two@example.com',
        name: 'Creator Two',
      },
    ]);

    await expect(handleWorkspaceProjectCreatorsRoute({
      method: 'PATCH',
      req: { headers: { 'x-request-id': 'req-1' } } as never,
      res,
      deps: {} as never,
      user: { id: 'admin-1', email: 'admin-1@example.com', name: 'Admin One' },
      workspaces: [{ id: 'ws-1', created_at: '2026-03-01T00:00:00Z' }],
      workspaceId: 'ws-1',
      json,
      readBody,
    })).resolves.toBe(true);

    expect(updateRegisteredWorkspaceProjectCreators).toHaveBeenCalledWith('ws-1', [
      {
        user_id: 'creator-new',
        email: 'creator-new@example.com',
        name: 'Creator New',
      },
      {
        user_id: 'creator-two@example.com',
        email: 'creator-two@example.com',
        name: 'Creator Two',
      },
    ]);
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: 'workspace.project_creators.updated',
        requestId: 'req-1',
        metadata: {
          added_identifiers: ['creator-new', 'creator-two@example.com'],
          removed_identifiers: ['creator-old'],
          total_identifiers: 3,
        },
      }),
    );
    expect(json).toHaveBeenCalledWith(res, 200, {
      items: [
        {
          id: 'creator-new',
          user_id: 'creator-new',
          name: 'Creator New',
          email: 'creator-new@example.com',
        },
        {
          id: 'creator-two@example.com',
          user_id: 'creator-two@example.com',
          name: 'Creator Two',
          email: 'creator-two@example.com',
        },
      ],
      total: 2,
    });
  });
});
