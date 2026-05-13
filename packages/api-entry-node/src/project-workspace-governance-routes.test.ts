import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeProjectAuditEvent,
  getRegisteredWorkspaceConfig,
  updateRegisteredWorkspaceProjectCreators,
  buildWorkspaceMembersFromConfig,
  resolveWorkspacePermissions,
  resolveKeycloakDirectoryUsersByIds,
  searchKeycloakDirectoryUsers,
} = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
  getRegisteredWorkspaceConfig: vi.fn(),
  updateRegisteredWorkspaceProjectCreators: vi.fn(),
  buildWorkspaceMembersFromConfig: vi.fn(),
  resolveWorkspacePermissions: vi.fn(),
  resolveKeycloakDirectoryUsersByIds: vi.fn(),
  searchKeycloakDirectoryUsers: vi.fn(),
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
  searchKeycloakDirectoryUsers,
}));

import {
  handleWorkspaceDirectoryUsersRoute,
  handleWorkspaceProjectCreatorsRoute,
} from './project-workspace-governance-routes.js';

describe('project-workspace-governance-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    resolveWorkspacePermissions.mockResolvedValue(['workspace:governance:update']);
    getRegisteredWorkspaceConfig.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace One',
      login_idp: {
        url: 'http://localhost:18080',
        realm: 'mbos',
        client_id: 'agentsmith',
      },
      directory_idp: {
        client_id: 'agentsmith-directory',
        client_secret: 'directory-secret',
      },
      project_creators: [],
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    });
  });

  it('lists non-admin workspace project creators', async () => {
    buildWorkspaceMembersFromConfig.mockResolvedValue([
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
    buildWorkspaceMembersFromConfig.mockResolvedValue([
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

    expect(resolveKeycloakDirectoryUsersByIds).toHaveBeenCalledWith({
      url: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith-directory',
      clientSecret: 'directory-secret',
      userIds: ['creator-new', 'creator-new', 'creator-two@example.com'],
    });
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

  it('searches workspace directory users from login_idp config', async () => {
    const json = vi.fn();
    const res = {} as never;
    searchKeycloakDirectoryUsers.mockResolvedValue([
      {
        user_id: 'user-2',
        email: 'integration-user@example.com',
        name: 'Integration User',
      },
    ]);

    await expect(handleWorkspaceDirectoryUsersRoute({
      req: {
        headers: {},
        url: '/api/v1/workspaces/ws-1/directory/users?query=integration-user%40example.com',
      } as never,
      res,
      user: { id: 'admin-1', email: 'admin-1@example.com', name: 'Admin One' },
      workspaces: [{ id: 'ws-1', created_at: '2026-03-01T00:00:00Z' }],
      workspaceId: 'ws-1',
      json,
    })).resolves.toBe(true);

    expect(searchKeycloakDirectoryUsers).toHaveBeenCalledWith({
      url: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith-directory',
      clientSecret: 'directory-secret',
      query: 'integration-user@example.com',
    });
    expect(json).toHaveBeenCalledWith(res, 200, {
      items: [
        {
          user_id: 'user-2',
          email: 'integration-user@example.com',
          name: 'Integration User',
        },
      ],
      total: 1,
    });
  });

  it('fails workspace directory search closed when directory client credentials are missing', async () => {
    getRegisteredWorkspaceConfig.mockResolvedValueOnce({
      id: 'ws-1',
      name: 'Workspace One',
      login_idp: {
        url: 'http://localhost:18080',
        realm: 'mbos',
        client_id: 'agentsmith',
      },
      directory_idp: {
        client_id: 'agentsmith-directory',
      },
      project_creators: [],
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    });
    const json = vi.fn();
    const res = {} as never;

    await expect(handleWorkspaceDirectoryUsersRoute({
      req: {
        headers: {},
        url: '/api/v1/workspaces/ws-1/directory/users?query=integration-user%40example.com',
      } as never,
      res,
      user: { id: 'admin-1', email: 'admin-1@example.com', name: 'Admin One' },
      workspaces: [{ id: 'ws-1', created_at: '2026-03-01T00:00:00Z' }],
      workspaceId: 'ws-1',
      json,
    })).resolves.toBe(true);

    expect(searchKeycloakDirectoryUsers).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(res, 503, {
      error_code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
      message: 'keycloak_directory_unavailable',
    });
  });
});
