import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const registryModule = vi.hoisted(() => ({
  updateSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { PATCH } from '../route';

describe('/api/system/workspaces/[id]', () => {
  beforeEach(() => {
    sessionModule.isSystemAdminAuthenticated.mockReset();
    registryModule.updateSystemWorkspace.mockReset();
  });

  it('returns 401 when system admin session is missing', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(false);

    const response = await PATCH(
      new Request('http://localhost/api/system/workspaces/ws_alpha', { method: 'PATCH' }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(401);
  });

  it('updates workspace config for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.updateSystemWorkspace.mockResolvedValue({ id: 'ws_alpha' });

    const response = await PATCH(
      new Request('http://localhost/api/system/workspaces/ws_alpha', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alpha Workspace',
          workspace_admin: 'ops-admin@example.com',
          idp_url: 'https://login.example.com',
          idp_realm: 'alpha',
          idp_client_id: 'alpha-client',
        }),
      }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(200);
    expect(registryModule.updateSystemWorkspace).toHaveBeenCalledWith(
      'ws_alpha',
      expect.objectContaining({
        workspace_admin: 'ops-admin@example.com',
      }),
    );
  });
});
