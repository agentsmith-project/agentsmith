import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspacePayload } from './helpers';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const registryModule = vi.hoisted(() => ({
  listSystemWorkspaces: vi.fn(),
  createSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { GET, POST } from '../route';

describe('/api/system/workspaces', () => {
  beforeEach(() => {
    sessionModule.isSystemAdminAuthenticated.mockReset();
    registryModule.listSystemWorkspaces.mockReset();
    registryModule.createSystemWorkspace.mockReset();
  });

  it('returns 401 when system admin session is missing', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('returns workspace items for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.listSystemWorkspaces.mockResolvedValue([
      { id: 'ws_alpha', name: 'Alpha Workspace' },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'ws_alpha', name: 'Alpha Workspace' }],
    });
  });

  it('creates a workspace for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.createSystemWorkspace.mockResolvedValue({ id: 'ws_alpha' });

    const response = await POST(
      new Request('http://localhost/api/system/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createWorkspacePayload()),
      }),
    );

    expect(response.status).toBe(201);
    expect(registryModule.createSystemWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alpha Workspace',
        workspace_admin_user_id: 'kc-alpha-admin',
      }),
    );
  });
});
